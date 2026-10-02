#!/usr/bin/env zsh
# Runs the completion in a real interactive zsh and checks what it offers.
# Usage: scripts/test.zsh

emulate -L zsh
zmodload zsh/zpty zsh/datetime || exit 1

local -i COMPLETION_TIMEOUT_SECONDS=60
local root=${0:A:h:h}
export VERCEL_COMPLETION_DIR=$root
export VERCEL_TEST_TMP=$(mktemp -d)
export VERCEL_TEST_OUT=$VERCEL_TEST_TMP/candidates
trap 'rm -rf $VERCEL_TEST_TMP' EXIT

local -a candidates
local -i failures=0
local project=$VERCEL_TEST_TMP/project
mkdir -p $project/app
touch $project/vercel.json

candidates_for() {
  local line
  local -F deadline=$(( EPOCHREALTIME + COMPLETION_TIMEOUT_SECONDS ))
  rm -f $VERCEL_TEST_OUT
  (
    cd $project
    zpty vercel_test zsh -f -i
    zpty -w vercel_test "source $root/scripts/tests/capture.zsh"
    until [[ $line == ready* ]] || (( EPOCHREALTIME > deadline )); do
      zpty -r -t vercel_test line || sleep 0.01
    done
    zpty -w -n vercel_test "$1"$'\t'
    # zpty does not report the shell exiting, so the output file appearing marks the end. The pty
    # is drained meanwhile because the shell blocks once its output buffer is full.
    until [[ -e $VERCEL_TEST_OUT ]] || (( EPOCHREALTIME > deadline )); do
      zpty -r -t vercel_test line || sleep 0.01
    done
    zpty -d vercel_test
  )
  if [[ ! -e $VERCEL_TEST_OUT ]]; then
    print -r -- "FAIL  '$1' did not finish completing within ${COMPLETION_TIMEOUT_SECONDS}s"
    exit 1
  fi
  candidates=("${(@f)$(<$VERCEL_TEST_OUT)}")
}

fail() {
  print -r -- "FAIL  $1"
  (( failures++ ))
}

offers() {
  local line=$1 expected
  shift
  candidates_for $line
  for expected in $@; do
    if (( ! $candidates[(Ie)$expected] )); then
      fail "'$line' should offer '$expected', got: $candidates"
      return
    fi
  done
  print -r -- "ok    '$line' offers $@"
}

offers_only() {
  local line=$1
  shift
  candidates_for $line
  if [[ ${(j: :)${(ou)candidates}} != ${(j: :)${(ou)@}} ]]; then
    fail "'$line' should offer exactly '$@', got: $candidates"
    return
  fi
  print -r -- "ok    '$line' offers only $@"
}

never_offers() {
  local line=$1 unexpected
  shift
  candidates_for $line
  for unexpected in $@; do
    if (( $candidates[(Ie)$unexpected] )); then
      fail "'$line' should not offer '$unexpected'"
      return
    fi
  done
  print -r -- "ok    '$line' does not offer $@"
}

if zsh -n $root/_vercel; then
  print -r -- "ok    _vercel parses"
else
  fail "_vercel has syntax errors"
fi

local pinned=$(<$root/vercel-version)
if [[ $(<$root/_vercel) == *"bundled with Vercel CLI $pinned "* ]]; then
  print -r -- "ok    _vercel was generated from vercel $pinned"
else
  fail "_vercel was not generated from the version in vercel-version ($pinned)"
fi

offers 'vercel ' deploy env sandbox switch help ls
offers 'vc ' deploy env
offers 'vercel env ' add ls pull rm
offers 'vercel --scope acme env ' add pull
offers 'vercel help env ' add pull
offers 'vercel --pr' --prod
offers 'vercel env add --' --force --token
offers_only 'vercel env add NAME ' production preview development
offers_only 'vercel env pull --environment ' production preview development
offers_only 'vercel env ls --format ' json
offers_only 'vercel deploy ' app
offers_only 'vercel ./' app
offers 'vercel --local-config ' app vercel.json
offers 'vercel env run -- ech' echo
offers 'vercel vcr permissions repository ' add clear
offers 'vercel sandbox snapshots ' list ls tree
offers 'vercel sandbox create --' --name
never_offers 'vercel sandbox create --' --cwd --debug
never_offers 'vercel switch --' --token

candidates_for 'vercel-sweep '
if (( $#candidates == 1 )) && [[ $candidates[1] == 'swept '<100->' command paths' ]]; then
  print -r -- "ok    $candidates[1], each offering exactly its declared options"
else
  fail "option sweep: ${(F)candidates}"
fi

if (( failures )); then
  print -r -- "$failures failed"
  exit 1
fi
print -r -- "all passed"

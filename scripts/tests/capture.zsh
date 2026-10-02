# Sourced inside the throwaway interactive shell that scripts/test.zsh drives through a pty.
# The first TAB runs one completion, writes every offered candidate to $VERCEL_TEST_OUT and exits.

PROMPT=
fpath=($VERCEL_COMPLETION_DIR ${0:A:h} $fpath)
autoload -Uz compinit
compinit -u -d $VERCEL_TEST_TMP/zcompdump
bindkey '^I' complete-word

typeset -ga vercel_test_output

compadd() {
  # -O, -A and -D only fill arrays for the caller and add no matches.
  if [[ ${@[1,(i)(-|--)]} == *-(O|A|D)\ * ]]; then
    builtin compadd "$@"
    return
  fi
  local -a hits
  builtin compadd -A hits "$@"
  vercel_test_output+=($hits)
  builtin compadd "$@"
}

vercel_test_finish() {
  # The runner treats the file appearing as "done", so it must never see it half written.
  print -rl -- $vercel_test_output > $VERCEL_TEST_OUT.partial
  mv $VERCEL_TEST_OUT.partial $VERCEL_TEST_OUT
  exit
}
comppostfuncs=(vercel_test_finish)

print ready

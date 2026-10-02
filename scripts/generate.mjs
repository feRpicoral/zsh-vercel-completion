#!/usr/bin/env node
// Usage: node scripts/generate.mjs <path to an installed `vercel` package> > _vercel

import fs from 'node:fs';
import path from 'node:path';

const MAX_DESCRIPTION_LENGTH = 120;
const SYSTEM_ENVIRONMENTS = '(production preview development)';
const OUTPUT_FORMATS = ['table', 'json', 'csv'];
const DEFAULT_COMMAND = 'deploy';
const SANDBOX_COMMAND = 'sandbox';
const TYPE_NAME_PLACEHOLDER = /^(String|Number|Boolean)$/;

const ARGUMENT_ACTIONS = {
  'project-path': '_files -/',
  dir: '_files -/',
  pathToFile: '_files',
  pathToFileOrUrl: '_files',
  file: '_files',
  filename: '_files',
  zonefile: '_files',
  src: '_files',
  dst: '_files',
  environment: SYSTEM_ENVIRONMENTS,
};

const packageDir = process.argv[2];
if (!packageDir) {
  throw new Error('Pass the path to the installed `vercel` package');
}
const distDir = path.join(packageDir, 'dist');
// A global install nests the dependency under `vercel`; a local install hoists it next to it.
const sandboxDir = [
  path.join(packageDir, 'node_modules', SANDBOX_COMMAND),
  path.join(packageDir, '..', SANDBOX_COMMAND),
].find(dir => fs.existsSync(path.join(dir, 'package.json')));
if (!sandboxDir) {
  throw new Error(`Cannot find the \`${SANDBOX_COMMAND}\` package that ${packageDir} depends on`);
}

function findFile(dir, pattern, marker) {
  const match = fs
    .readdirSync(dir)
    .filter(file => pattern.test(file))
    .find(file => fs.readFileSync(path.join(dir, file), 'utf8').includes(marker));
  if (!match) {
    throw new Error(`No file in ${dir} contains "${marker}"`);
  }
  return path.join(dir, match);
}

function isLiteralAlternation(text) {
  return /^[a-z][a-z0-9-]*(\|[a-z][a-z0-9-]*)+$/.test(text);
}

function summarize(text) {
  let summary = (text ?? '').split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  if (summary.length > MAX_DESCRIPTION_LENGTH) {
    const sentence = summary.match(/^(.{20,}?[.;])\s+[A-Z`]/);
    if (sentence) {
      summary = sentence[1];
    }
  }
  if (summary.length > MAX_DESCRIPTION_LENGTH) {
    summary = `${summary.slice(0, MAX_DESCRIPTION_LENGTH).replace(/\s+\S*$/, '')}...`;
  }
  return summary;
}

function optionAction(option) {
  const { name, argument, description = '', choices } = option;
  if (choices) {
    return `(${choices.join(' ')})`;
  }
  if (argument && isLiteralAlternation(argument)) {
    return `(${argument.split('|').join(' ')})`;
  }
  if (argument === 'FILE') {
    return '_files';
  }
  if (argument === 'DIR') {
    return '_files -/';
  }
  if (argument === 'PATH' && /\b(file|image)\b/i.test(description)) {
    return '_files';
  }
  if (name === 'environment' || (name === 'target' && /environment/i.test(description))) {
    return SYSTEM_ENVIRONMENTS;
  }
  if (name === 'format' && argument === 'FORMAT') {
    const formats = OUTPUT_FORMATS.filter(format => new RegExp(`\\b${format}\\b`).test(description));
    if (formats.length > 0) {
      return `(${formats.join(' ')})`;
    }
  }
  return ' ';
}

function argumentAction(name) {
  if (ARGUMENT_ACTIONS[name]) {
    return ARGUMENT_ACTIONS[name];
  }
  // `version|latest` mixes a placeholder with a literal, so only the all-literal case is expanded
  if (name === 'enable|disable|status' || name === 'true|false') {
    return `(${name.split('|').join(' ')})`;
  }
  return ' ';
}

function optionFromStruct(option) {
  const takesValue = option.type ? option.type !== Boolean : Boolean(option.argument);
  return {
    long: option.name,
    short: option.shorthand ?? null,
    takesValue,
    repeatable: Array.isArray(option.type),
    label: !option.argument || TYPE_NAME_PLACEHOLDER.test(option.argument) ? option.name : option.argument,
    description: summarize(option.description),
    action: takesValue ? optionAction(option) : null,
  };
}

function nodeFromStruct(struct) {
  const options = (struct.options ?? []).filter(option => !option.deprecated).map(optionFromStruct);
  const defaultSubcommand = (struct.subcommands ?? []).find(subcommand => subcommand.default);
  for (const option of defaultSubcommand?.options ?? []) {
    if (!option.deprecated && !options.some(existing => existing.long === option.name)) {
      options.push(optionFromStruct(option));
    }
  }
  return {
    name: struct.name,
    aliases: struct.aliases ?? [],
    description: summarize(struct.description),
    options,
    args: (struct.arguments ?? []).map(argument => {
      const name = argument.name.replace(/^<|>$/g, '');
      return {
        name,
        required: argument.required,
        multiple: Boolean(argument.multiple),
        action: argumentAction(name),
      };
    }),
    subcommands: (struct.subcommands ?? []).filter(subcommand => !subcommand.hidden).map(nodeFromStruct),
    argumentsBeforeSubcommand: Boolean(struct.argumentsBeforeSubcommand),
    disabledGlobalOptions: struct.disabledGlobalOptions ?? [],
    inheritsGlobalOptions: true,
  };
}

function nodeFromSandboxHelp(help, meta) {
  const node = {
    name: meta.name,
    aliases: meta.aliases ?? [],
    description: summarize(help.data.description),
    options: [],
    args: [],
    subcommands: [],
    argumentsBeforeSubcommand: false,
    disabledGlobalOptions: [],
    inheritsGlobalOptions: false,
  };
  for (const topic of help.data.helpTopics ?? []) {
    if (topic.category === 'arguments') {
      const name = topic.usage.replace(/^[<[]|[>\]]$/g, '');
      const multiple = name.startsWith('...');
      const label = name.replace(/^\.\.\./, '');
      node.args.push({ name: label, required: !multiple, multiple, action: argumentAction(label) });
      continue;
    }
    const long = topic.usage.match(/--([\w-]+)/)?.[1];
    if (!long) {
      throw new Error(`Cannot parse sandbox option usage "${topic.usage}"`);
    }
    const label = topic.usage.match(/<([^>]+)>/)?.[1] ?? null;
    node.options.push({
      long,
      short: topic.usage.match(/(?:^|[\s,])-(\w)(?![\w-])/)?.[1] ?? null,
      takesValue: label !== null,
      // cmd-ts lists no default (not even "optional") only for options that may be repeated
      repeatable: label !== null && topic.defaults.length === 0,
      label,
      description: summarize(topic.description),
      action: label !== null && isLiteralAlternation(label) ? `(${label.split('|').join(' ')})` : ' ',
    });
  }
  return node;
}

async function loadSandboxTree() {
  const appFile = findFile(path.join(sandboxDir, 'dist'), /^app-.*\.mjs$/, 'require_cjs as ');
  const source = fs.readFileSync(appFile, 'utf8');
  const exportName = local => {
    const match = source.match(new RegExp(`\\b${local} as (\\w+)`));
    if (!match) {
      throw new Error(`sandbox no longer exports ${local}`);
    }
    return match[1];
  };
  const module = await import(appFile);
  const cmdTs = module[exportName('require_cjs')]();
  const app = module[exportName('app')]({ appName: `vercel ${SANDBOX_COMMAND}` });

  let captured;
  cmdTs.setDefaultHelpFormatter({
    formatCommand: data => {
      captured = { isGroup: false, data };
      return '';
    },
    formatSubcommands: data => {
      captured = { isGroup: true, data };
      return '';
    },
  });

  const build = async (commandPath, meta) => {
    captured = undefined;
    await cmdTs.runSafely(app, [...commandPath, '--help']);
    if (!captured) {
      throw new Error(`No help captured for sandbox ${commandPath.join(' ')}`);
    }
    const help = captured;
    const node = nodeFromSandboxHelp(help, meta);
    if (help.isGroup) {
      node.options.push({
        long: 'help',
        short: 'h',
        takesValue: false,
        repeatable: false,
        label: null,
        description: 'show help',
        action: null,
      });
      for (const command of help.data.commands) {
        node.subcommands.push(await build([...commandPath, command.name], command));
      }
    }
    return node;
  };
  return build([], { name: SANDBOX_COMMAND });
}

function quote(text) {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function optionSpec(option) {
  const explanation = option.description
    ? `[${option.description.replace(/\\/g, '\\\\').replace(/]/g, '\\]')}]`
    : '';
  const value = option.takesValue ? `:${option.label.replace(/:/g, '\\:')}:${option.action}` : '';
  const long = `--${option.long}${option.takesValue ? '=' : ''}`;
  if (!option.short) {
    return quote(`${option.repeatable ? '*' : ''}${long}${explanation}${value}`);
  }
  const short = `-${option.short}${option.takesValue ? '+' : ''}`;
  const prefix = option.repeatable ? '*' : `(-${option.short} --${option.long})`;
  return `${quote(prefix)}{${short},${long}}${quote(`${explanation}${value}`)}`;
}

function argumentSpec(argument) {
  const label = argument.name.replace(/:/g, '\\:');
  if (argument.name === 'command' && argument.multiple) {
    return quote('*:: :_vercel_command');
  }
  if (argument.multiple) {
    return quote(`*:${label}:${argument.action}`);
  }
  return quote(`${argument.required ? ':' : '::'}${label}:${argument.action}`);
}

function withoutTakenNames(options, taken) {
  const free = [];
  for (const option of options) {
    if (taken.some(other => other.long === option.long)) {
      continue;
    }
    const shortIsTaken = option.short !== null && taken.some(other => other.short === option.short);
    free.push(shortIsTaken ? { ...option, short: null } : option);
  }
  return free;
}

function emitNode(node, commandPath, globalOptions, lines) {
  const options = [];
  for (const option of node.options) {
    options.push(...withoutTakenNames([option], options));
  }

  const applicableGlobals = node.inheritsGlobalOptions
    ? withoutTakenNames(
        globalOptions.filter(global => !node.disabledGlobalOptions.includes(global.long)),
        options
      )
    : [];
  const usesSharedGlobals =
    applicableGlobals.length === globalOptions.length &&
    applicableGlobals.every((global, index) => global === globalOptions[index]);

  const positionals = node.args.map(argumentSpec);
  if (node.subcommands.length > 0) {
    const commandState = quote(': :->command');
    if (node.argumentsBeforeSubcommand) {
      positionals.push(commandState);
    } else {
      positionals.splice(0, 1, commandState);
    }
  }

  const body = [];
  if (!usesSharedGlobals) {
    body.push('globals=0');
  }
  if (node.argumentsBeforeSubcommand) {
    body.push(`skip=${node.args.length}`);
  }
  if (node.subcommands.length > 0) {
    body.push('subs=(');
    for (const subcommand of node.subcommands) {
      for (const name of [subcommand.name, ...subcommand.aliases]) {
        body.push(`  ${quote(`${name}:${subcommand.description}`)}`);
      }
    }
    body.push(')');
    const aliases = node.subcommands.flatMap(subcommand =>
      subcommand.aliases.map(alias => `${alias} ${subcommand.name}`)
    );
    if (aliases.length > 0) {
      body.push(`alias_pairs=(${aliases.join(' ')})`);
    }
  }
  const specs = [...options, ...(usesSharedGlobals ? [] : applicableGlobals)].map(optionSpec);
  if (specs.length > 0) {
    body.push('opts=(', ...specs.map(spec => `  ${spec}`), ')');
  }
  if (positionals.length > 0) {
    body.push(`args=(${positionals.join(' ')})`);
  }

  if (body.length > 0) {
    lines.push(`    ${quote(commandPath)})`, ...body.map(line => `      ${line}`), '      ;;');
  }
  for (const subcommand of node.subcommands) {
    const subcommandPath = commandPath ? `${commandPath} ${subcommand.name}` : subcommand.name;
    emitNode(subcommand, subcommandPath, globalOptions, lines);
  }
}

const { commandsStructs } = await import(
  findFile(path.join(distDir, 'chunks'), /\.js$/, 'commandsStructs,getCommandAliases')
);
const { globalCommandOptions } = await import(
  findFile(path.join(distDir, 'chunks'), /\.js$/, 'globalCommandOptions,GLOBAL_CLI_FLAG_NAMES')
);
const { rootHelpCommands } = await import(path.join(distDir, 'root-help-commands.mjs'));
const { version } = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
const sandboxVersion = JSON.parse(fs.readFileSync(path.join(sandboxDir, 'package.json'), 'utf8')).version;

const rootDescriptions = new Map(
  rootHelpCommands.flatMap(command => command.names.map(name => [name, command.description]))
);
const sandboxTree = await loadSandboxTree();

const topLevel = commandsStructs
  .filter(struct => !struct.hidden)
  .map(struct => {
    const node = struct.name === SANDBOX_COMMAND ? sandboxTree : nodeFromStruct(struct);
    node.description = summarize(rootDescriptions.get(struct.name) ?? struct.description);
    return node;
  });

// `vercel --help` lists `switch` as its own command although it is registered as an alias of
// `teams`; invoked that way it runs `teams switch`.
const teams = topLevel.find(node => node.name === 'teams');
const teamsSwitch = teams.subcommands.find(node => node.name === 'switch');
teams.aliases = teams.aliases.filter(alias => alias !== 'switch');
topLevel.push({ ...teamsSwitch, aliases: [], description: summarize(rootDescriptions.get('switch')) });

const globalOptions = globalCommandOptions
  .filter(option => !option.deprecated && option.description)
  .map(optionFromStruct);

const deploy = topLevel.find(node => node.name === DEFAULT_COMMAND);
const root = {
  name: '',
  aliases: [],
  description: '',
  options: [
    ...deploy.options,
    {
      long: 'changelog',
      short: null,
      takesValue: false,
      repeatable: false,
      label: null,
      description: 'Show the 5 latest Vercel product updates',
      action: null,
    },
  ],
  args: [],
  subcommands: topLevel,
  argumentsBeforeSubcommand: false,
  disabledGlobalOptions: [],
  inheritsGlobalOptions: true,
};

const nodeLines = [];
emitNode(root, '', globalOptions, nodeLines);

const output = `#compdef vercel vc

# Generated from the command definitions bundled with Vercel CLI ${version} (sandbox ${sandboxVersion}).
# Hidden commands and deprecated options are left out, as they are in \`vercel --help\`.

_vercel_node() {
  subs=() alias_pairs=() opts=() args=() globals=1 skip=0
  case $1 in
${nodeLines.join('\n')}
  esac
}

# _arguments leaves the "--" separator in front of the wrapped command line.
_vercel_command() {
  if [[ $words[1] == -- ]]; then
    shift words
    (( CURRENT-- ))
  fi
  _normal
}

_vercel_globals() {
  global_opts=(
${globalOptions.map(option => `    ${optionSpec(option)}`).join('\n')}
  )
}

_vercel_load() {
  local spec flag
  _vercel_node "$node"
  (( globals )) && opts+=($global_opts)
  alias_of=($alias_pairs)
  value_flags=()
  for spec in $opts; do
    spec=\${spec#\\(*\\)}
    flag=\${\${spec#\\*}%%[\\[:]*}
    [[ $flag == *[=+] ]] && value_flags+=(\${flag%[=+]})
  done
}

_vercel() {
  local curcontext=$curcontext state state_descr line node word
  local -a subs alias_pairs opts args value_flags global_opts expl
  local -A opt_args alias_of
  local -i globals skip i=2 start=1 positional=0 ret=1

  _vercel_globals
  _vercel_load
  while (( i < CURRENT )); do
    word=$words[i]
    if [[ $word == -- ]]; then
      break
    elif [[ $word == -?* ]]; then
      [[ $word != *=* ]] && (( $value_flags[(Ie)$word] )) && (( i++ ))
    elif (( skip > 0 )); then
      (( skip-- ))
    elif (( ! positional )); then
      word=\${alias_of[$word]:-$word}
      if [[ -z $node && $word == help ]]; then
        start=$i
      elif (( $subs[(I)\${(b)word}:*] )); then
        node="\${node:+$node }$word"
        start=$i
        _vercel_load
      else
        positional=1
      fi
    fi
    (( i++ ))
  done

  words=($words[1] "\${(@)words[start+1,-1]}")
  (( CURRENT -= start - 1 ))

  _arguments -s -S -C : $opts $args && ret=0
  if [[ $state == command ]]; then
    _describe -t commands 'vercel command' subs && ret=0
    if [[ -z $node && $PREFIX == [./~]* ]]; then
      _wanted directories expl 'project path' _path_files -/ && ret=0
    fi
  fi
  return ret
}

_vercel "$@"
`;

process.stdout.write(output);

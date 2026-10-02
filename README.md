# zsh-vercel-completion

Tab completion for the [Vercel CLI](https://vercel.com/docs/cli) in zsh. Completion only: no aliases, no wrapper functions.

`_vercel` is generated from the command definitions that ship inside the `vercel` npm package, so it matches what `vercel --help` reports for the version in [`vercel-version`](vercel-version). A scheduled workflow regenerates it against the latest release every day and opens a pull request when something changed.

## What it completes

- Every command and nested subcommand, with descriptions (`vercel env`, `vercel firewall rules add`, `vercel ai-gateway api-keys create`, ...)
- Aliases such as `ls`, `rm`, `rr`, `mf` and the `vc` binary
- Options per command plus the global ones, including short flags
- Values where the CLI declares them: environments, `--format`, declared choices, files and directories
- The `vercel sandbox` command tree, which comes from a separate package
- `vercel help <command>`, bare `vercel --prod` style deploys, and the wrapped command in `vercel env run -- <command>`

Hidden commands and deprecated options are left out, as they are in `vercel --help`. Nothing is fetched from the Vercel API, so project names, team slugs and deployment URLs are not completed.

## Installation

### Oh My Zsh

```bash
git clone https://github.com/feRpicoral/zsh-vercel-completion.git \
  ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-vercel-completion
```

Add it to the plugins array in `~/.zshrc`:

```bash
plugins=(... zsh-vercel-completion)
```

Then reload the shell:

```bash
exec zsh
```

### Other plugin managers

Load `zsh-vercel-completion.plugin.zsh` the way your manager loads any plugin. It adds the directory to `fpath` and registers the completion itself when `compinit` has already run.

### Manual

```bash
git clone https://github.com/feRpicoral/zsh-vercel-completion.git
```

```bash
fpath=(/path/to/zsh-vercel-completion $fpath)
autoload -Uz compinit && compinit
```

## Development

The generator needs Node (see `.nvmrc`) and has no dependencies of its own.

Regenerate against a published release, `latest` by default:

```bash
scripts/update.sh 62.1.0
```

Or against a `vercel` package that is already installed:

```bash
node scripts/generate.mjs "$(npm root -g)/vercel" > _vercel
```

Run the tests, which drive a real interactive zsh through a pty and check what it offers:

```bash
scripts/test.zsh
```

The generator reads internal modules of the CLI bundle rather than a public API. If a release moves them, it fails with an error naming what it could not find instead of producing a partial file.

## Troubleshooting

If completions do not show up after installing, rebuild the completion cache:

```bash
rm -f ~/.zcompdump*
exec zsh
```

## License

MIT. Not affiliated with Vercel.

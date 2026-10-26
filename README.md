# Nanocoder Desktop

Built by the [Nano Collective](https://nanocollective.org) — a community collective building AI tooling not for profit, but for the community.

A local-first desktop workspace around [Nanocoder](https://github.com/Nano-Collective/nanocoder): durable project chats, file browsing, Git review, a terminal and an isolated browser the agent can use.

> [!NOTE]
> **Pre-v0.1.** Nanocoder Desktop is being built in the open. There is no release yet, stability is not promised, and anything here can change.

## What it will do

Nanocoder Desktop is for handing a task to Nanocoder and reviewing the result, without living in a terminal. The first release is planned to let you:

- add a project and start or resume its Nanocoder chats, with streamed reasoning, tool calls and approvals;
- delegate bounded subtasks and follow each one;
- browse files and review the repository's real Git changes, then send comments back to the chat;
- run the project in an integrated terminal;
- let Nanocoder inspect and act in an isolated in-app browser, with approval for sensitive actions;
- close everything, relaunch, and continue the same chat.

It does not add a second agent. Nanocoder keeps its models, prompts, tools, approvals, MCP servers and chat history; the desktop is the workspace around it. It is not an IDE.

Like every Nano Collective project, it aims to be **privacy-respecting**, **local-first** and **open for all**: provider keys stay in Nanocoder's own configuration, and projects, chats and the agent stay on your machine.

## Quick start

There is nothing to install yet. The first builds will be alpha prereleases on [GitHub Releases](https://github.com/Nano-Collective/nanocoder-desktop/releases). To help build it, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Status

- Approved for build by the Nano Collective on 12 October 2026. The case for building it is the [Nanocoder Desktop whitepaper](https://docs.nanocollective.org/collective/whitepapers/nanocoder-desktop).
- Work follows the phases in the [roadmap](planning/roadmap.md), starting with the repository scaffold.
- Open work is listed in the [work list](https://github.com/Nano-Collective/nanocoder-desktop/issues/17).

## Documentation

- [Planning set](planning/index.md): scope, architecture, ACP integration, security, features and roadmap.
- [Design](DESIGN.md): how the app looks.
- User documentation will live in [`docs/`](docs/) and on [docs.nanocollective.org](https://docs.nanocollective.org) once there is something to use.

## Community

The Nano Collective is a community-led group building open-source AI tools for the people who use them. Contributions of every shape are welcome.

- **Contribute**: see [CONTRIBUTING.md](CONTRIBUTING.md) for how to get started.
- **The Nano Collective**: [nanocollective.org](https://nanocollective.org) · [docs](https://docs.nanocollective.org) · [GitHub](https://github.com/Nano-Collective) · [Discord](https://discord.gg/ktPDV6rekE)
- **Support the work**: the [Support page](https://docs.nanocollective.org/collective/organisation/support) covers donations and sponsorship.
- **Paid contribution**: the [Economics Charter](https://docs.nanocollective.org/collective/organisation/economics-charter) sets out how scoped paid work happens.

## Licence

MIT. See [LICENSE](LICENSE).

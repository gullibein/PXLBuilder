# Games built with the app by a real model, as saved by the user

Each file opens in PXLBuilder as an ordinary game. The ones named `with-history` were saved with
**⋯ → Save with history…** and also hold how the game was made: the requests, the answers, the console, the
last play (docs/engine-architecture-proposal.md §26.2). No API key is in any of them (each was searched for one
before it was put here). They are in the repository with the user's permission, as the first recordings for
the real-AI evaluation (§25) and as the evidence behind the write-ups named below.

| File | What was asked for | Written up in |
| --- | --- | --- |
| `chess.pxlproj.json` | Chess (game only; its log was pasted, not saved) | §24.9 |
| `tic-tac-toe.pxlproj.json` | "A cool tic-tac-toe game" (game only) | §26 |
| `dash-platformer.with-history.pxlproj.json` | A platformer whose player can dash and wall jump | §27 |
| `crime-city.with-history.pxlproj.json` | An open city seen from above with cars, people and police | §28 |
| `pinball.with-history.pxlproj.json` | "A crazy cool pinball game" | §31 |
| `card-game.with-history.pxlproj.json` | A card game played card on card against the computer (asked in Icelandic) | §31 |

## What these files are used for now

They are the games the evaluation harness is proven on (`src/evaluation`, §33 of the engineering document): each is
judged as the answer to its case, and the two that hold their answers in full (`pinball`, `crime-city`) are
played again through the real request flow in the tests, with no network. A test searches every file here for
anything that looks like an API key.

## What is in them besides the games (the repository is public)

Searched for and not found: an API key, an e-mail address, a person's name, a path on a disk, an account id, a
network address. In them: the requests as typed (English and Icelandic), one web address pasted into a request,
the browser and operating system as the browser names them, the screen's size, the app's version, the times of
saves and requests, the AI settings (never a key), the totals spent, the console's lines, the last play's
report, and the AI's answers.


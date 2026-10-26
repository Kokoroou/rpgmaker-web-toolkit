---
description: "Cloudflare free plan limits that matter for an RPG Maker web game: files, requests, R2 storage and Access users, and what the toolkit does past them."
lang: en
---

# Free plan limits

| Service | Limit | In practice |
|---|---|---|
| Workers Static Assets | 20,000 files, 25 MiB each | Most games fit. Larger files go to R2 automatically; too many files: [`exclude`](/setup/configuration#common-changes) |
| Workers requests | 100,000 / day | Only save requests and R2 files count, not normal game files |
| R2 | 10 GB; 1M writes and 10M reads / month | Saves are tiny, even with their [older copies](/reference/config) (`saveHistory`). Large files of all your games share the 10 GB |
| R2 sign-up | Payment method required | Even on the free tier |
| Cloudflare Access | 50 users | |
| Upload of one file | About 300 MiB | Larger files fail |

Cloudflare's pricing pages have the current numbers.

## When Cloudflare changes them

The limits the toolkit enforces (file count and size per file for static assets) live in [`cli/limits.json`](https://github.com/Kokoroou/rpgmaker-web-toolkit/blob/main/cli/limits.json). Each deploy downloads the copy on `main`, so a pinned `RWK_REF` or an old clone follows a change as soon as the file is updated, without a new release. Offline, it uses the last downloaded copy, or the one it ships with: whichever is newest.

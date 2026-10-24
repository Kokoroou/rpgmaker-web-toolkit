# Free plan limits

| Service | Limit | In practice |
|---|---|---|
| Workers Static Assets | 20,000 files, 25 MiB each | Most games fit. Larger files go to R2 automatically; too many files: [`exclude`](/setup/configuration#common-changes) |
| Workers requests | 100,000 / day | Only save requests and R2 files count, not normal game files |
| R2 | 10 GB; 1M writes and 10M reads / month | Saves are tiny. Large files of all your games share the 10 GB |
| R2 sign-up | Payment method required | Even on the free tier |
| Cloudflare Access | 50 users | |
| Upload of one file | About 300 MiB | Larger files fail |

Cloudflare's pricing pages have the current numbers.

# Free plan limits

Everything runs on Cloudflare's free plan. These are the limits worth knowing:

| Service | Limit | What it means |
|---|---|---|
| Workers Static Assets | 20,000 files, 25 MiB per file | Most games fit. Over 20,000 files, leave some out with [`exclude`](/setup/configuration#leave-files-out). Larger files go to R2 automatically |
| Workers requests | 100,000 per day | Only save requests and files served from R2 count; normal game files do not |
| R2 | 10 GB stored; 1 million writes and 10 million reads per month | Saves are small. Large files of every game you publish count toward the 10 GB |
| R2 sign-up | Payment method required | Even on the free tier |
| Cloudflare Access | 50 users | Plenty for personal use |
| Upload of one large file | About 300 MiB | Larger files fail to upload |

Check current numbers on Cloudflare's pricing pages; they change from time to time.

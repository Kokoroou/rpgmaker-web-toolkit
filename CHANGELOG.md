# Changelog

## 0.1.0 (2026-10-24)


### ⚠ BREAKING CHANGES

* the CLI now stops on Node.js 22 or older; install Node.js 24 LTS (`winget install OpenJS.NodeJS.LTS`).
* the CLI now stops on Node.js 22 or older; install Node.js 24 LTS (`winget install OpenJS.NodeJS.LTS`).

### Features

* delete save slots from the save panel ([e141537](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/e141537e6f31000c5ec6c44abd58b23ee2cdc6a3))
* delete save slots from the save panel ([877ac70](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/877ac7055456af6e7d0a382b082aa650d4af652f))
* deploy RPG Maker MZ/MV games to Cloudflare Workers ([c6375fe](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/c6375fec659c0f417d27588ff1ae313a0ef1494d))
* deploy RPG Maker MZ/MV games to Cloudflare Workers ([d383da9](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/d383da956b4cc591176c75141f8b580f25bbe43c))
* export saves for external save editors and import them back ([dc11520](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/dc11520e873850650dc98713d562875ff4eec24e))
* export saves for external save editors and import them back ([c0ab493](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/c0ab4930c989d94680c50e3d9956a3d8a58a4088))
* group the advanced tools behind one ⚙ menu ([a4d8a5a](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/a4d8a5a494dadd57bcdf8ce348255f23f4438eb2))
* hide single buttons in edit mode, fade the controls, close game keys with ⌨ ([7038747](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/70387476a91775a30088ff0f3d4ad3eceacb53ed))
* hide single buttons, subtler controls, close game keys with ⌨ ([1342239](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/1342239b19ec33f0d0b77bc476b2837010e4ef63))
* honour the game creator's hosting policy, keep sites out of search engines ([37d3ae2](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/37d3ae257183bfaa7055a8ca3ce713ba174c8c8f))
* JoiPlay-style on-screen gamepad that fits phones ([0a99e58](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/0a99e58da47ac970ec5863799a4ca07a4d40b1dd))
* JoiPlay-style on-screen gamepad that fits phones in both orientations ([0348458](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/03484588840aefda19d7a71f6a80bbd366be0b93))
* least-privilege Cloudflare login in a dedicated wrangler profile ([46b264c](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/46b264c792eb994fc978183f3c0402b367917fb8))
* log in with least-privilege scopes in a dedicated wrangler profile ([2f4f6bf](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/2f4f6bf2f1a7395e1c356caf134a0fd3ce009e26))
* require Node.js 24 or newer and move GitHub Actions to Node 24 runtimes ([b97ae38](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/b97ae38ad462b99cb3140db3f3f24c23f2d8f696))
* require Node.js 24 or newer and move GitHub Actions to Node 24 runtimes ([7da572f](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/7da572f227187a48cb97cbaf4e93e81054dc728e))
* run from a one-line PowerShell command without cloning ([ce366cf](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/ce366cf2c0182a2bc55e7c9b885b65a0c10ab6b7))
* split the toolbar into left and right groups, eye icon for show / hide ([b163961](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/b163961645b9bd7eec5ad1de2759f58fc4b60673))
* use several items at once from the item menu ([f1dc88f](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/f1dc88f10a171c00f6de59d8b930826bdfec6e16))
* use several items at once, ⚙ tools menu, reorganized toolbar ([5d9e7c6](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/5d9e7c6c6d80ce02107302b10cb192c203c14f70))


### Bug Fixes

* center the game above the controls, relock landscape in fullscreen, move plugin keys to a panel ([f5a4beb](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/f5a4bebc328e5a29bc747a47096ad438ffb39d7d))
* draw images larger than the GPU texture limit at reduced size ([46c89ec](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/46c89ec22697294efdce7567eba730c74685d021))
* draw images larger than the GPU texture limit at reduced size ([ca94632](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/ca94632a9b3083ca9c3b19a922705e44ab2fc9dd))
* draw the toolbar and tools menu icons as monochrome SVG ([d00da49](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/d00da495ce0ceed88a3a506209e2c574f5956913))
* leave the game title out of the save slot details ([629b2c5](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/629b2c56941d83cd7c2da098052e329e6d75e306))
* leave the game title out of the save slot details ([3e12e4d](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/3e12e4d55611d191859c99ad79edc5b9e6a5a73f))
* phone layout in portrait and fullscreen, plugin keys in a panel, desktop scrollbar ([2393925](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/2393925b571b39fd7688938bd247f7adc602d886))
* plugin keys only in the panel, cleaner hints, closable panel ([0ee1e3b](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/0ee1e3bf167c239aeceed97b2076ae539ccacf6b))
* show plugin keys only in the panel, clean up their hints, close the panel by tapping outside ([8e04b6f](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/8e04b6fd26c9cf5e7b18582d03d87f5e390937b6))

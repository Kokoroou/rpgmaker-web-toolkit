# Changelog

## [0.3.0](https://github.com/Kokoroou/rpgmaker-web-toolkit/compare/v0.2.0...v0.3.0) (2026-10-25)


### Features

* **cli:** rename a game's site and keep its saves ([#42](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/42)) ([b14bd9d](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/b14bd9d4fdb6dfd646845de3df304067c19b74bf))
* **cli:** update the toolkit of a deployed game from its link ([#44](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/44)) ([f550bcc](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/f550bcc42c390a787a6685c834d2cafb72cece82))
* **controls:** simpler touch toolbar with settings menu and full screen button ([#37](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/37)) ([a961836](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/a96183636c6f45450d5985ac898c01b1a975f7c0))


### Bug Fixes

* **cli:** let saves made under an older MV game title continue after import ([#41](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/41)) ([5cd8580](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/5cd8580d5a8cb744349eea5ccfdc38969851c14d))
* **cli:** open the Worker's Access page and follow its new Access flow ([#43](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/43)) ([b208a77](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/b208a77da3b07563ed191ebe62d7041e72142d7b))
* **controls:** find the MV game canvas when laying out the controls ([#39](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/39)) ([0480aba](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/0480abaf1e7b950308def829f7efe3d8dcc26caa))

## [0.2.0](https://github.com/Kokoroou/rpgmaker-web-toolkit/compare/v0.1.0...v0.2.0) (2026-10-24)


### Features

* **cli:** read the free plan limits from cli/limits.json on main ([#23](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/23)) ([e34a1af](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/e34a1af6edf175ed5c372a475dd71d90ed0e29dc))
* **cli:** warn about non-ASCII file names and end each deploy with a build report ([#28](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/28)) ([b4b87b1](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/b4b87b1e513ae947fd3ae8b3e67065519a04fe3b))
* **runtime:** add an Always dash switch to the ⏸ menu ([#32](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/32)) ([4a75037](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/4a75037f861f050f9f4c80777f8cb4f4ddb4d36a))
* **runtime:** add an in-game problem report with audio diagnostics ([#27](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/27)) ([09238b2](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/09238b2bc0dade9a94ae1663dccf88de82433413))
* **runtime:** add fast forward ×2 / ×3 / ×4 ([#30](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/30)) ([999e71d](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/999e71d461d3b8ee830776fb29a16c23d9c31f4b))
* **runtime:** add message modes: tap to finish, Auto, Skip ([#31](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/31)) ([3cdfe5d](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/3cdfe5dd5be9fc7269128eed320d5c36dc28f993))
* **runtime:** give several items at once when an event asks for one ([#36](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/36)) ([1154913](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/1154913077e49ef3a5191127d0746e34329ecb3f))
* **runtime:** replace the ⚙ tools list with a ⏸ menu that pauses the game ([#29](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/29)) ([7e8e34d](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/7e8e34d9563842ba64626fa432a90542e1e61403))
* **runtime:** use several items at once in battle ([#35](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/35)) ([b6458f8](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/b6458f814287532b350a56678c35bc77e9aaa986))
* **saves:** add quick save / load, autosave and a ☁ sync status icon ([#33](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/33)) ([63b0f2d](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/63b0f2d114601344042bc8d68f8e3483edfc79d6))
* **saves:** keep older saves in the cloud and restore them from the ⏸ menu ([#34](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/34)) ([66079e1](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/66079e17c3855f2b99bbb86a9b4c4adc59dfc03b))


### Bug Fixes

* **runtime:** play Ogg audio and WebM movies on phones in MV games that ship no m4a/mp4 ([#26](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/26)) ([e386f3b](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/e386f3b0b0df82091b87cf3ccf8fe604cb4b14bb))

## 0.1.0 (2026-10-24)


### ⚠ BREAKING CHANGES

* the CLI now stops on Node.js 22 or older; install Node.js 24 LTS (`winget install OpenJS.NodeJS.LTS`).
* the CLI now stops on Node.js 22 or older; install Node.js 24 LTS (`winget install OpenJS.NodeJS.LTS`).

### Features

* delete save slots from the save panel ([e141537](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/e141537e6f31000c5ec6c44abd58b23ee2cdc6a3), [877ac70](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/877ac7055456af6e7d0a382b082aa650d4af652f))
* deploy RPG Maker MZ/MV games to Cloudflare Workers ([c6375fe](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/c6375fec659c0f417d27588ff1ae313a0ef1494d), [d383da9](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/d383da956b4cc591176c75141f8b580f25bbe43c))
* export saves for external save editors and import them back ([dc11520](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/dc11520e873850650dc98713d562875ff4eec24e), [c0ab493](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/c0ab4930c989d94680c50e3d9956a3d8a58a4088))
* group the advanced tools behind one ⚙ menu ([a4d8a5a](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/a4d8a5a494dadd57bcdf8ce348255f23f4438eb2))
* hide single buttons in edit mode, fade the controls, close game keys with ⌨ ([7038747](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/70387476a91775a30088ff0f3d4ad3eceacb53ed))
* hide single buttons, subtler controls, close game keys with ⌨ ([1342239](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/1342239b19ec33f0d0b77bc476b2837010e4ef63))
* honour the game creator's hosting policy, keep sites out of search engines ([37d3ae2](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/37d3ae257183bfaa7055a8ca3ce713ba174c8c8f))
* JoiPlay-style on-screen gamepad that fits phones ([0a99e58](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/0a99e58da47ac970ec5863799a4ca07a4d40b1dd))
* JoiPlay-style on-screen gamepad that fits phones in both orientations ([0348458](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/03484588840aefda19d7a71f6a80bbd366be0b93))
* least-privilege Cloudflare login in a dedicated wrangler profile ([46b264c](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/46b264c792eb994fc978183f3c0402b367917fb8))
* log in with least-privilege scopes in a dedicated wrangler profile ([2f4f6bf](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/2f4f6bf2f1a7395e1c356caf134a0fd3ce009e26))
* require Node.js 24 or newer and move GitHub Actions to Node 24 runtimes ([b97ae38](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/b97ae38ad462b99cb3140db3f3f24c23f2d8f696), [7da572f](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/7da572f227187a48cb97cbaf4e93e81054dc728e))
* run from a one-line PowerShell command without cloning ([ce366cf](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/ce366cf2c0182a2bc55e7c9b885b65a0c10ab6b7))
* split the toolbar into left and right groups, eye icon for show / hide ([b163961](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/b163961645b9bd7eec5ad1de2759f58fc4b60673))
* use several items at once from the item menu ([f1dc88f](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/f1dc88f10a171c00f6de59d8b930826bdfec6e16))
* use several items at once, ⚙ tools menu, reorganized toolbar ([5d9e7c6](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/5d9e7c6c6d80ce02107302b10cb192c203c14f70))


### Bug Fixes

* center the game above the controls, relock landscape in fullscreen, move plugin keys to a panel ([f5a4beb](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/f5a4bebc328e5a29bc747a47096ad438ffb39d7d))
* draw images larger than the GPU texture limit at reduced size ([46c89ec](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/46c89ec22697294efdce7567eba730c74685d021), [ca94632](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/ca94632a9b3083ca9c3b19a922705e44ab2fc9dd))
* draw the toolbar and tools menu icons as monochrome SVG ([d00da49](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/d00da495ce0ceed88a3a506209e2c574f5956913))
* leave the game title out of the save slot details ([629b2c5](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/629b2c56941d83cd7c2da098052e329e6d75e306), [3e12e4d](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/3e12e4d55611d191859c99ad79edc5b9e6a5a73f))
* phone layout in portrait and fullscreen, plugin keys in a panel, desktop scrollbar ([2393925](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/2393925b571b39fd7688938bd247f7adc602d886))
* plugin keys only in the panel, cleaner hints, closable panel ([0ee1e3b](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/0ee1e3bf167c239aeceed97b2076ae539ccacf6b))
* show plugin keys only in the panel, clean up their hints, close the panel by tapping outside ([8e04b6f](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/8e04b6fd26c9cf5e7b18582d03d87f5e390937b6))

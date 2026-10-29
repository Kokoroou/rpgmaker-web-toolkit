# Changelog

## [0.6.0](https://github.com/Kokoroou/rpgmaker-web-toolkit/compare/v0.5.0...v0.6.0) (2026-10-29)


### Features

* **cli:** check R2 and the workers.dev subdomain in doctor ([#99](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/99)) ([6a03a77](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/6a03a7722f3c301c3a2b68774d374fd35726d985))
* **cli:** delete a game's saves and large files with delete --purge ([#104](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/104)) ([7f578ac](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/7f578acd5e84e88f6344f1a23bcda2d5d564eb9d))
* **cli:** name the site of a first deploy with --name ([#103](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/103)) ([e7f53b0](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/e7f53b09ba91847dc6f8ce18868a73cb43877509))
* **cli:** pick one of several Cloudflare accounts with --account ([#110](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/110)) ([e9efa2c](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/e9efa2c718f3a357497baa53c2bcff05ea70623b))
* **cli:** preview rename and saves import with --dry-run ([#101](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/101)) ([5aa2237](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/5aa22370c638d8d1f3b86df20d000ee1a4f3b6ba))
* **cli:** read or change one setting with config --get / --set ([#100](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/100)) ([f30cf65](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/f30cf65942521a952bd1962025c7bdaa728246dd))
* **cli:** read the site name and file patterns from rwk.json in the game folder ([#108](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/108)) ([eca1897](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/eca189747fd1002f4ee6156c4067c5f310dea68c))
* **cli:** show the site's toolkit version in status ([#97](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/97)) ([7952ccd](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/7952ccd581cc4b42de3006dd8b81eb8fb686b569))
* **cli:** show upload progress and number the deploy steps ([#109](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/109)) ([f762e27](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/f762e27c3636f58dc95cea934ec56b0a57f63334))
* **cli:** show warnings and errors as GitHub Actions annotations ([#96](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/96)) ([fa962ac](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/fa962ac6ca5d2c99566197d87c0053084ec77dfd))
* **cli:** upgrade a game from its folder ([#102](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/102)) ([69992d2](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/69992d2f8e7a660d543db701a28dfb10b51c0f58))
* **runtime:** add live machine translation through Workers AI ([#107](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/107)) ([05a950c](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/05a950c879f9d87ae0ccc3592bcede55775f25fc))
* **runtime:** go back one level in the settings menu with the phone's Back key ([#98](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/98)) ([cae0a86](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/cae0a86e586eb97884446983d11c8caa72776c23))
* **runtime:** open each settings group on its own page ([#92](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/92)) ([1cf7f88](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/1cf7f888917e81f98350748dedf3f47191437e0e))
* **runtime:** search the settings menu when it has many rows ([#95](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/95)) ([e73cc48](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/e73cc4877878d4eac9fb5189af7c5c6c593d177d))
* **runtime:** show switches and segmented choices in the settings menu ([#94](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/94)) ([d2d8df4](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/d2d8df444307cfd4ad0388be37a8e86fd4c58581))

## [0.5.0](https://github.com/Kokoroou/rpgmaker-web-toolkit/compare/v0.4.0...v0.5.0) (2026-10-27)


### Features

* **cli:** add analyze, deploy --dry-run and doctor, and use the current folder as the default game ([#81](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/81)) ([1ccec5d](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/1ccec5dceca9d6b5b91c8f93889e5f06da6cd093))
* **cli:** add status, saves export, logs, open, list and delete from a link or site name ([#77](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/77)) ([7bb3671](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/7bb3671ccd5aa1cab66a800faff6c5a13357752f))
* **cli:** clear answered menus in rwk config ([#76](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/76)) ([e8330f6](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/e8330f6f3e6143fb50e6f027bf648657577385ae))
* **cli:** enable Cloudflare Access through the API on deploy ([#78](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/78)) ([1956437](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/19564373ed1414237b14a5068601f7b79c0acdf1))
* **cli:** warn about file paths that work on Windows but not on the web ([#84](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/84)) ([83ea506](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/83ea5068db77db4563d5bcf6bb1863ba31659acf))
* **controls:** hide L/R buttons by default and lower default opacity ([#74](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/74)) ([ba7b56f](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/ba7b56f2a4625d5c1077182a62e08fa62cd8d291))
* **controls:** remap keyboard keys and gamepad buttons ([#82](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/82)) ([8b38126](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/8b38126c82a3445256cb7c6b707c4c0df715aaee))
* **runtime:** add play offline with a full download and install as an app ([#83](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/83)) ([f174f1e](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/f174f1e3b1c4949d17e0634e8e60ba36b1fc56b5))
* **runtime:** pick a translation from data-xx folders ([#85](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/85)) ([777c4ac](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/777c4ac40335a2acac4025930f75cb59f55008a1))
* **runtime:** split the cheats panel into tabs with search and browse ([#86](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/86)) ([9ce10bf](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/9ce10bf3e9f5c0167c2395f732480146b62f0cb2))

## [0.4.0](https://github.com/Kokoroou/rpgmaker-web-toolkit/compare/v0.3.0...v0.4.0) (2026-10-26)


### ⚠ BREAKING CHANGES

* **cli:** shorten config edit and site rename to config and rename ([#72](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/72))
* **cli:** standardize the command syntax and the output ([#70](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/70))

### Features

* add presets, per-feature limits and per-player settings ([#58](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/58)) ([15f8d45](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/15f8d458b9d4b256612939a87164ddd67cda0199))
* apply edit-config feature settings without a redeploy ([#65](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/65)) ([2a12b4a](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/2a12b4a62811fed833af77acd52b640ecbf0883f))
* **cli:** add macOS and Linux launchers ([#56](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/56)) ([c89b53c](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/c89b53c2d62359f171adfe399adad1772620947a))
* **cli:** config edit asks questions instead of opening a JSON file ([#71](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/71)) ([28983b2](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/28983b250f2a424ce389757ce3469915b77492fa))
* **cli:** publish from CI with a --json result and a GitHub Action ([#63](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/63)) ([b7c89c5](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/b7c89c537e02b28915faf084e5c5529a3a4cc460))
* **cli:** run without questions in CI, with an API token login ([#62](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/62)) ([edee9c1](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/edee9c1e85b4062e0be919b640c29a2622bff726))
* **cli:** shorten config edit and site rename to config and rename ([#72](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/72)) ([8490e04](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/8490e043415d5fa1eeae6868dc47f6a03fa20b87))
* **cli:** standardize the command syntax and the output ([#70](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/70)) ([26c4301](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/26c4301c6bb9d992052dc3b3b3412f66f53d2498))
* **controls:** larger touch targets and a pull-down settings sheet for phones ([#67](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/67)) ([bc1ed1e](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/bc1ed1e87e5e8bfdabc1f601e0c1ec5d87852b4e))
* **runtime:** add a messages log players can reopen ([#54](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/54)) ([3c86feb](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/3c86feb84de5d9f0fc38568baf70a02a171cfd69))
* **runtime:** add basic cheats, off unless the deployer turns them on ([#61](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/61)) ([bd92805](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/bd92805521402292dbba82b736c8cef8a5f4f749))
* **runtime:** add switches, variables and movement to the cheats ([#64](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/64)) ([39d2f15](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/39d2f151c19f64de77f0143945619bf4bff701b7))
* **runtime:** cache game files in the browser with a Service Worker ([#53](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/53)) ([b013f6b](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/b013f6b04a17be7757a09211db7228710225187a))
* **runtime:** show the cached game files and let players clear them ([#60](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/60)) ([67aa12e](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/67aa12eea8c963a8cb90d1c1e509c6f0325c2e31))


### Bug Fixes

* **cli:** restore the missing print import that fails every deploy at the end ([#68](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/68)) ([163cf2f](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/163cf2fe5e2138d0931a681546a0e3c6413c4fdc))
* **cli:** send credentials when fetching the web manifest ([#69](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/69)) ([1a8d785](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/1a8d7855870887bffdb19007971ec9cf2e3a11e1))
* **controls:** lay out once per rotation instead of once per event ([#52](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/52)) ([9e57fed](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/9e57fedcd1208ff36a918b829e90c2543b5ae469))
* **runtime:** stop the problem report keeping decoded audio alive ([#50](https://github.com/Kokoroou/rpgmaker-web-toolkit/issues/50)) ([77e8869](https://github.com/Kokoroou/rpgmaker-web-toolkit/commit/77e8869d8bed49bcc513420111ffd84ac3d880ee))

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

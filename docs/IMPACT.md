# Đánh giá tác động lên nhà phát triển và cộng đồng người chơi

Tài liệu này trả lời: toolkit (và các tính năng dự kiến trong [FEATURE_IDEAS.md](FEATURE_IDEAS.md)) có thể ảnh hưởng thế nào tới nhà phát triển game RPG Maker, nhất là nhà phát triển độc lập / circle doujin, và tới cộng đồng người chơi. Phần cuối là các đề xuất giảm rủi ro.

**Trạng thái (cập nhật):** các đề xuất 1–6, 8 và 11 ở mục 5 đã được thi công, xem cột "Trạng thái". Mục 6 đánh giá giấy phép.

Trước tài liệu này, dự án chỉ có đoạn "Responsible use" ngắn trong README và trang chủ user guide, cùng vài ghi chú về phát tán rải rác trong FEATURE_IDEAS (#20 tải .zip, mục "Chặn thật hay chỉ ẩn nút"). Chưa có phần nào nhìn từ phía nhà phát triển.

**Lưu ý về nguồn.** Không có khảo sát hay số liệu nào về việc người chơi tự host game RPG Maker. Phần lớn bằng chứng là bình luận trên itch.io, Steam, diễn đàn, cộng với văn bản luật và điều khoản dịch vụ. Những gì dưới đây là đánh giá định tính, không phải đo lường. Đây cũng không phải tư vấn pháp lý.

## 1. Tóm tắt

| | Tác động chính | Mức độ |
|---|---|---|
| **Người chơi** | Chơi được trên điện thoại / máy không cài được game, không mất save, đồng bộ nhiều thiết bị | Tích cực, cao |
| **Nhà phát triển: khi dùng đúng mục đích** (một người, game đã mua, Access bật) | Gần như không đổi so với việc người chơi chép game sang máy khác hay dùng JoiPlay. Không có bản sao mới nào đến tay người chưa mua | Thấp |
| **Nhà phát triển: khi bị lạm dụng** (tắt Access, chia link, mời nhiều email) | Thành một trang phát tán game có giao diện điện thoại tốt, chạy miễn phí, khó bị phát hiện hơn link tải | Cao với game bán ít, giá thấp |
| **Nhà phát triển: về mô hình kinh doanh** | Cạnh tranh trực tiếp với những thứ một số dev đang bán riêng: bản Android, bản chơi trên web cho Patreon | Trung bình |
| **Nhà phát triển: về trải nghiệm thiết kế** | Tua nhanh, Skip, cheat, quick save khi game khóa lưu (dự kiến) thay đổi nhịp và độ khó dev đã chọn | Thấp–trung bình, tùy game |
| **Nhà phát triển: cơ hội** | Chính dev có thể dùng toolkit để phát bản test / bản cho người ủng hộ, có đăng nhập email và cloud save | Tích cực, chưa được khai thác |
| **Dự án** | Rủi ro pháp lý và uy tín nằm ở người deploy, nhưng tên dự án sẽ bị gắn với các trường hợp lạm dụng | Trung bình |

Kết luận ngắn: thiết kế ban đầu (khóa site đến khi bật Access, mỗi email một save, không giải mã tài nguyên) đã đặt đúng hướng. Rủi ro lớn nhất không nằm ở tính năng nào cụ thể mà ở **chế độ "No protection"** và ở việc **chia link cho nhiều người**: hai thứ biến công cụ chơi cá nhân thành kênh phát tán.

## 2. Bối cảnh: toolkit làm gì với file game

Để đánh giá đúng, cần rõ toolkit **không** làm gì:

- **Không giải mã, không trích xuất tài nguyên.** File `.rpgmvp` / `.png_` đã mã hóa được đưa lên nguyên trạng; engine trong trình duyệt tự giải mã như bản desktop. (Mã hóa của MV/MZ vốn chỉ là XOR với khóa nằm trong `data/System.json`, công cụ giải mã như [rmvdec](https://github.com/Bioruebe/rmvdec) có sẵn từ lâu, nên toolkit không làm việc trích tài nguyên dễ hơn.)
- **Không sửa thư mục game gốc**, không gỡ DRM. Game RPG Maker trên Steam / itch / DLsite phần lớn vốn không có DRM.
- **Không có danh mục game, không tìm kiếm, không chia sẻ giữa người dùng.** Mỗi người tự deploy trên tài khoản Cloudflare của mình.

Điều toolkit **có** làm: tạo một bản sao đầy đủ của game trên máy chủ (Workers Static Assets + R2) và phục vụ nó qua Internet. Đây là điểm khác cơ bản với JoiPlay / Maldives / MTool, vốn chạy file trên chính máy người chơi.

## 3. Tác động lên nhà phát triển

### 3.1. Phát tán: rủi ro lớn nhất

**Cơ chế.** Một site không có Access, hoặc có Access nhưng mời nhiều email, là một bản game chơi được ngay, không cần tải, không cần cài, chạy tốt trên điện thoại. Với game bán giá thấp trên DLsite / itch, người nhận link không còn lý do mua. So với link tải lậu, site web còn:

- dễ dùng hơn (không cần giải nén, không cần JoiPlay);
- khó phát hiện hơn (không nằm trên trang chia sẻ file mà dev hay rà soát; `*.workers.dev` không có danh mục);
- miễn phí cho người host (Static Assets không tính băng thông).

**Hiện trạng trong toolkit.**

| Biện pháp | Có chưa | Ghi chú |
|---|---|---|
| Site bị khóa đến khi bật Access | Có | Tốt: mặc định an toàn |
| Chế độ "No protection" | Có, hỏi xác nhận một lần | Chỉ một câu "Really make the site public?". Không hỏi người deploy có phải tác giả / có quyền không |
| Cảnh báo khi Access bị tắt | Có, ở mỗi lần deploy | Chỉ khi người đó deploy lại |
| Giới hạn số người được mời | Gián tiếp (Access free: 50 user) | 50 người là đủ để phát tán trong một nhóm nhỏ / Discord |
| Ngăn máy tìm kiếm index | Đã có | `X-Robots-Tag: noindex` (qua `_headers` của static assets và trong Worker), meta `robots`, `robots.txt`. Chỉ site public có lý do và chủ động xin mới được index |
| Kênh để dev báo vi phạm | Đã có | Trang "For game creators" trong user guide: [Cloudflare abuse / DMCA](https://www.cloudflare.com/abuse/) (Workers lưu nội dung nên Cloudflare gỡ được), mở issue |

**Vị trí pháp lý (tham khảo).**

- **Nhật Bản** (nơi phần lớn game RPG Maker doujin ra đời): Điều 30 Luật Bản quyền chỉ cho phép sao chép để dùng cá nhân / trong gia đình. Đưa tác phẩm lên máy chủ để truyền tới người khác thuộc quyền truyền tải công cộng / quyền "làm cho có thể truyền tải" (公衆送信権・送信可能化権, Điều 23) của tác giả, nằm ngoài phạm vi dùng cá nhân. Xem [Copyright Law of Japan, chương 2](https://www.cric.or.jp/english/clj/cl2.html), [hướng dẫn của Đại học Toyohashi](https://imc.tut.ac.jp/en/network/filesharing-and-copyright.html), [Wikipedia: Right to Make Transmittable](https://en.wikipedia.org/wiki/Right_to_Make_Transmittable).
- **Mỹ**: Copyright Office và nhiều tòa án chưa công nhận "space shifting" (chuyển bản mình có sang chỗ khác) là fair use; việc đưa lên "cloud locker" cá nhân chưa được phân xử dứt khoát ([tóm tắt hồ sơ 1201](https://www.copyright.gov/1201/2021/comments/opposition/Class_6_Opp'n_Joint%20Creators%20and%20Copyright%20Owners.pdf)).
- **Điều khoản cửa hàng**: Steam cấp quyền dùng "personal, non-commercial" và nói rõ nội dung là "licensed, not sold" ([Steam Subscriber Agreement](https://store.steampowered.com/subscriber_agreement/)). Nhiều game có EULA / readme riêng cấm 再配布 / 無断転載.
- **RPG Maker**: [điều khoản của ツクール](https://rpgmakerofficial.com/support/rule/) cho phép **người làm game** phát hành game (kể cả bán), cấm tái phân phối riêng lẻ tài nguyên RTP. Điều khoản này không trao quyền gì cho người chơi.

Hệ quả: dùng một mình với game đã mua là vùng xám nhưng rủi ro thấp (không ai khác nhận được bản sao). Mời người khác chơi, dù chỉ vài người, là truyền tải tới người khác và nằm ngoài "dùng cá nhân" ở hầu hết các nước. Câu trong README "by yourself or with people close to you" (site/index.md) **rộng hơn** những gì luật Nhật cho phép rõ ràng (chỉ trong gia đình hoặc tương đương).

### 3.2. Mô hình kinh doanh

Nhiều dev RPG Maker độc lập không làm bản Android vì port MV/MZ lên điện thoại tốn công ([itch.io](https://itch.io/post/7572735), [itch.io](https://itch.io/post/11024199)). Người chơi được chỉ sang JoiPlay. Một số dev khác lại **bán** đúng những thứ toolkit làm miễn phí:

- bản chơi trên trình duyệt chỉ cho người ủng hộ Patreon / early access ([ví dụ](https://itch.io/post/11398863), [ví dụ](https://itch.io/post/15317370));
- bản Android / bản web riêng trên cửa hàng.

Với người đã mua bản PC, toolkit không lấy mất doanh thu (họ đã trả tiền). Nhưng nếu một người ủng hộ Patreon tự deploy bản PC rồi mời người khác vào, đó là thay thế trực tiếp cho tầng trả phí của dev. Không có số liệu về mức thiệt hại; với game có vài trăm người mua, vài chục người được mời đã là tỉ lệ đáng kể.

### 3.3. Trải nghiệm thiết kế (tính năng dự kiến)

Tua nhanh, Skip thoại, cheat, quick save khi game khóa lưu (FEATURE_IDEAS #1, #2, #3, #5, #8) giống những gì JoiPlay, MTool và các plugin cheat đã cung cấp, nên **không tạo ra hành vi mới** trong cộng đồng. Tuy vậy:

- Một số dev cố ý không đưa debug / cheat menu vì sửa switch / biến làm người chơi thấy sự kiện chưa từng xảy ra và báo lỗi oan ([ví dụ](https://itch.io/post/766928)). Bản ghi lỗi từ game đã bị cheat sẽ tới tay dev như lỗi thật.
- Game kinh dị / game cố ý cấm lưu (boss, đoạn căng thẳng) mất tác dụng nếu quick save bỏ qua khóa lưu.
- Ở chiều ngược lại, cộng đồng accessibility coi tua nhanh / chế độ dễ là cách để người khó khăn về vận động, thời gian hoàn thành game ([Rock Paper Shotgun qua Pixel Poppers](https://pixelpoppers.com/link/the-modders-creating-accessibility-modes-for-notoriously-difficult-games/the-modders-creating-accessibility-modes-for-notoriously-difficult-games/)).

Mức độ: thấp với người chơi một mình (lựa chọn của họ); đáng kể hơn khi người deploy bật cheat cho cả nhóm, và khi lỗi từ bản đã sửa bị báo cho dev.

### 3.4. Dịch máy (FEATURE_IDEAS #7)

Đa số game được dịch là game tiếng Nhật của circle doujin. DLsite đã làm chương trình dịch chính thức (Translators Unite) chính vì bản dịch tự phát lan qua các trang lậu ([DLsite](https://note.com/dlsite/n/n59164172e4df)). Dev có thể phản đối dịch máy vì chất lượng kém làm xấu tác phẩm ([Steam](https://steamcommunity.com/app/1410370/discussions/0/2948125678376403608)). Dịch trực tiếp trong trình duyệt cho một người là giống MTool; còn **bản dịch lưu trong R2 và dùng chung cho mọi người được mời** thì gần với việc phát hành một bản dịch không phép.

### 3.5. Tiền lệ: cloud gaming không xin phép

Năm 2020, GeForce Now cho người chơi chạy game họ đã mua trên máy chủ của Nvidia. Activision, Bethesda, 2K, Xbox Game Studios, Warner Bros, Klei và cả studio indie Hinterland (The Long Dark) rút game vì Nvidia không xin giấy phép phát qua cloud ([MCV](https://www.mcvuk.com/business-news/bethesda-pulls-almost-all-of-its-games-from-nvidias-geforce-now-service/), [Liliputing](https://liliputing.com/2020/04/more-game-publishers-pull-titles-from-nvidias-geforce-game-streaming-platform.html), [Laptop Mag](https://www.laptopmag.com/uk/news/geforce-now-loses-acclaimed-indie-game-in-latest-cloud-gaming-setback)). Bài học: kể cả khi người chơi đã mua game, nhiều nhà phát triển coi "chạy game của tôi trên máy chủ để chơi từ xa" là quyền cần xin phép. Toolkit ở quy mô nhỏ hơn rất nhiều và không phải dịch vụ thương mại, nhưng phản ứng của dev indie có thể tương tự nếu dự án được biết đến rộng.

### 3.6. Cơ hội cho chính nhà phát triển

Phần này hiện chưa được nhắc trong tài liệu dự án, dù đây là nhóm dùng toolkit **hoàn toàn hợp pháp**:

- **Bản test kín**: mời tester bằng email, mỗi người một save, tester xuất save (💾 Saves) gửi kèm báo lỗi. Cập nhật chỉ tải phần thay đổi.
- **Bản cho người ủng hộ / early access trên web**: chính là thứ dev đang bán qua Patreon, với email login và cloud save có sẵn, trên gói free.
- **Demo / game miễn phí công khai**: chế độ "No protection" đúng mục đích của nó.
- **Thử bản điện thoại**: xem nút ảo, phím plugin, ảnh quá lớn trên GPU điện thoại trước khi quyết định làm port chính thức.

Giới hạn cho nhóm này: Access free tối đa 50 user, `workers.dev` không có tên miền riêng. Giấy phép cũ (PolyForm Noncommercial) cấm dùng thương mại, nên dev bán bản web cho Patreon không được dùng toolkit; quyền bổ sung "Game Creators" (mục 6) đã gỡ giới hạn này.

## 4. Tác động lên cộng đồng người chơi

### Tích cực

| Tác động | Ghi chú |
|---|---|
| **Chơi trên iPhone / máy không cài được game** | JoiPlay chỉ có trên Android và đã rời Google Play ([androidphoria](https://androidphoria.com/tutoriales/joiplay-en-android-que-es-donde-se-descarga-y-como-se-usa)); iOS gần như không có cách chơi MV/MZ. Toolkit chỉ cần trình duyệt |
| **Không mất save** | Than phiền lớn nhất với bản web / điện thoại (xem FEATURE_IDEAS mục 2). Cloud sync, xuất save theo định dạng desktop giải quyết trực tiếp |
| **An toàn hơn APK lạ** | Người chơi không phải cài APK JoiPlay từ trang không chính thức có adware ([retrohandheldhq](https://retrohandheldhq.com/posts/joiplay-setup-guide/)) |
| **Tiếp cận** | Nút ảo, tua nhanh, Auto thoại giúp người chơi khó khăn về vận động / thời gian |
| **Cộng đồng Việt Nam / người dịch** | Cập nhật bản dịch nhanh (chỉ tải phần đổi) |

### Tiêu cực / rủi ro

| Rủi ro | Ghi chú |
|---|---|
| **Quyền riêng tư của người được mời** | Người deploy thấy được email và save (`saves/<sha256(email)>/…` trong R2 của họ). Người chơi được mời nên biết điều này |
| **Phụ thuộc vào một người** | Người deploy xóa Worker, hết hạn mức R2, bị Cloudflare gỡ vì DMCA: người chơi mất site và save cloud. Xuất save là cách tự bảo vệ, cần được nói rõ |
| **Chuẩn mực cộng đồng** | Nếu "deploy rồi chia link" trở thành thói quen, cộng đồng RPG Maker có thể coi toolkit như công cụ phát tán, và dev phản ứng bằng cách mã hóa nặng hơn / dùng DRM, làm khó cả người chơi trung thực (như cách một số dev né mã hóa RPG Maker vì làm game lỗi: [itch.io](https://itch.io/post/8922397)) |
| **Báo lỗi sai cho dev** | Lỗi phát sinh do plugin của toolkit (ItemBatch, SaveSync) hay do cheat có thể bị báo cho dev như lỗi của game |

## 5. Đề xuất và trạng thái

| # | Đề xuất | Trạng thái | Thi công ở đâu |
|---|---|---|---|
| 1 | **Siết chế độ "No protection"**: hỏi vì sao site được công khai | Đã làm | `cli/commands/deploy.js` (`askPublic`, `checkPublic`). Ba lựa chọn: tôi làm game / tác giả cho phép / không (giữ khóa). Lưu `auth.basis` và `auth.since`. Site public cũ không có `basis` bị hỏi một lần ở lần deploy sau |
| 2 | **Không cho máy tìm kiếm index** | Đã làm | `cli/lib/stage.js` sinh `_headers`, `robots.txt`, meta `robots`; `worker/index.js` gửi header cho file lớn từ R2 và trang khóa. Chỉ site public có `basis` và `indexable: true` mới được index |
| 3 | **Viết lại "Responsible use"** | Đã làm | README, `site/index.md`: một mình, thiết bị của mình; chia cho bạn bè cũng nằm ngoài "dùng cá nhân" ở đa số nước; người deploy chịu trách nhiệm |
| 4 | **Trang "For game creators"** | Đã làm | `site/creators/index.md`: toolkit làm gì / không làm gì, dùng cho game của chính mình, báo vi phạm |
| 5 | **Nhắc khi nhiều email chơi** | Đã làm | `worker/players.js` ghi hash email khi lưu lần đầu (`rwk/players/<slug>.json`); CLI đếm sau mỗi deploy, nhắc khi > 5 email (> 1 nếu tác giả chọn `personal`) |
| 6 | **Opt-out / chính sách của tác giả** | Đã làm | `cli/lib/policy.js`, file `rwk-policy.json`: `hosting` = `none` / `personal` / `shared` / `public`, `features` tắt `saveTools` / `itemBatch` / `sync` (người deploy không bật lại được), `message`, `contact`. Tài liệu: `site/creators/policy.md` |
| 7 | Gói "Giữ nguyên trải nghiệm gốc", cheat mặc định tắt | Chờ | Làm cùng các tính năng trong FEATURE_IDEAS; `features` của policy sẽ nhận thêm khóa mới (`cheats`, `fastForward`…) |
| 8 | **Gắn nhãn bản web khi báo lỗi** | Đã làm (phần cơ bản) | `<meta name="generator" content="rpgmaker-web-toolkit">`; `RWK_Core` in dòng console và thêm ghi chú vào màn hình lỗi của engine: kiểm tra bản desktop trước khi báo cho tác giả. Phần "cheat đã từng bật" làm khi có cheat |
| 9 | Dịch máy: cache theo từng deploy, không xuất thành patch | Chờ | Khi làm #7 trong FEATURE_IDEAS |
| 10 | Không làm tải .zip (#20) trừ khi có opt-out | Giữ nguyên | Opt-out đã có; khi làm #20 phải tôn trọng `hosting` |
| 11 | **Điều chỉnh giấy phép cho tác giả game** | Đã làm | `LICENSE`: thêm "Additional Permission: Game Creators", xem mục 6 |
| 12 | Hỏi ý kiến trực tiếp các dev | Chưa | Việc của người duy trì dự án, không làm bằng code được |

### Giới hạn cần nói rõ

- `rwk-policy.json` là **lời đề nghị** toolkit tôn trọng, không phải DRM: ai cũng xóa được file hoặc sửa toolkit. Nó có tác dụng với số đông muốn làm đúng, và là bằng chứng rõ ràng ý muốn của tác giả khi họ cần gửi yêu cầu gỡ.
- Số email chỉ tăng, không giảm: email đã bị xóa khỏi Access vẫn được đếm. Đây là lời nhắc, không chặn gì.
- Câu hỏi "vì sao được công khai" dựa vào lời khai của người deploy. Nó làm người dùng dừng lại suy nghĩ và để lại ghi chép, chứ không kiểm chứng được.

## 6. Giấy phép

### Vấn đề của giấy phép cũ

PolyForm Noncommercial 1.0.0 cho phép mọi mục đích phi thương mại, nhưng **cấm thương mại với tất cả mọi người**, kể cả tác giả game dùng cho game của chính họ. Hệ quả: nhóm dùng toolkit hợp pháp nhất (dev phát bản web cho người ủng hộ Patreon, bản early access, bản test kín của studio) lại là nhóm bị cấm. Người chơi dùng cá nhân thì không bị ảnh hưởng.

### Các phương án đã cân nhắc

| Phương án | Dev indie | Ngăn lạm dụng | Nhận xét |
|---|---|---|---|
| Giữ PolyForm Noncommercial | Bị cấm dùng thương mại cho game của mình | Cấm "dịch vụ host game" thu tiền | Bảo vệ tốt nhưng bỏ rơi nhóm có lợi nhất |
| MIT / Apache-2.0 | Dùng tự do | Không: ai cũng mở được dịch vụ thu tiền host game của người khác bằng toolkit | Phổ biến nhất, nhưng mở cửa cho đúng kiểu lạm dụng mục 3.1 |
| PolyForm Small Business | Dùng được nếu dưới 100 người và dưới 1 triệu USD doanh thu | Không: một dịch vụ host lậu nhỏ cũng đủ điều kiện | Phân biệt theo quy mô, trong khi vấn đề là **game của ai**, không phải công ty to hay nhỏ |
| PolyForm Shield | Dùng được | Chỉ cấm cạnh tranh với chính toolkit | Không liên quan tới quyền của tác giả game |
| **PolyForm Noncommercial + quyền bổ sung cho tác giả game** (chọn) | Dùng mọi mục đích, kể cả thương mại, cho game họ sở hữu hoặc được phép phát hành; được đóng gói các plugin `runtime/` vào game của mình | Giữ nguyên: host game của người khác để kiếm tiền, bán dịch vụ host, bán lại toolkit vẫn bị cấm | Phân biệt đúng theo quyền đối với game |

### Nội dung quyền bổ sung ("Additional Permission: Game Creators")

- **Ai được:** người sở hữu bản quyền game, hoặc người được chủ sở hữu cho phép phát hành (nhà phát hành, người dịch / port có thỏa thuận).
- **Được làm gì:** dùng toolkit cho mọi mục đích, kể cả thương mại, để phát hành, host, thử nghiệm, bán hoặc cho truy cập game của mình; sao chép, sửa và phân phối các plugin trong `runtime/` bên trong game của mình trên mọi nền tảng (ví dụ đưa bộ nút ảo vào bản HTML5 bán trên itch.io).
- **Không bao gồm:** game không phải của mình (vẫn theo Noncommercial); cung cấp toolkit hoặc việc host bằng toolkit như dịch vụ cho game của người khác; bán toolkit như một sản phẩm.
- **Ghi chú bản quyền:** giữ dòng `Required Notice:` và link giấy phép ở đầu mỗi file plugin (đã thêm vào cả 5 file); không bắt ghi công trong game.

Quyền bổ sung được đặt trước văn bản PolyForm và không sửa văn bản đó. `package.json` đổi `license` thành `SEE LICENSE IN LICENSE` vì không còn là một mã SPDX đơn thuần.

Lưu ý: đây là thay đổi do chủ bản quyền quyết định. Văn bản được viết đơn giản và chưa qua luật sư; nên nhờ người có chuyên môn xem lại trước khi dự án được dùng rộng rãi cho mục đích thương mại.

## 7. Câu hỏi còn mở

- Có bao nhiêu deploy đang để "No protection"? Toolkit không thu thập dữ liệu nên không biết; chỉ có thể suy đoán qua issue / phản hồi.
- Dev doujin Nhật thực sự nghĩ gì về JoiPlay / MTool? Nguồn tìm được đều từ phía người chơi; cần tìm thêm trên Ci-en, Fantia, Twitter tiếng Nhật (từ khóa: 再配布禁止, JoiPlay 禁止, MTool 対策).
- `rwk-policy.json` có ai dùng không nếu chỉ một dự án nhỏ đề ra? Có thể đề xuất chung với JoiPlay / các công cụ tương tự để thành quy ước.

## Nguồn

- Luật và điều khoản: [Copyright Law of Japan (CRIC)](https://www.cric.or.jp/english/clj/cl2.html), [Right to Make Transmittable](https://en.wikipedia.org/wiki/Right_to_Make_Transmittable), [TUT: filesharing and copyright](https://imc.tut.ac.jp/en/network/filesharing-and-copyright.html), [Monolith Law: private reproduction](https://monolith.law/en/general-corporate/copyright-private-reproduction-japan), [US Copyright Office 1201 filing](https://www.copyright.gov/1201/2021/comments/opposition/Class_6_Opp'n_Joint%20Creators%20and%20Copyright%20Owners.pdf), [Steam Subscriber Agreement](https://store.steampowered.com/subscriber_agreement/), [ツクール 利用規約](https://rpgmakerofficial.com/support/rule/), [AUTOMATON: thay đổi điều khoản RTP 2023](https://automaton-media.com/articles/newsjp/20230512-247069/), [RPG Maker EULA](https://rpgmakerweb.com/eula)
- Cloudflare: [Abuse policy](https://www.cloudflare.com/abuse/), [Transparency report H2 2024](https://cf-assets.www.cloudflare.com/slt3lc6tev37/7vust2n7oACblNR2Jk7jZx/5b84afdbb6fbdcc751d6a7ba9a7f938b/H2_2024_AbuseProcessesTransparencyReport_AQFinal.pdf)
- Cloud gaming: [MCV: Bethesda rút khỏi GeForce Now](https://www.mcvuk.com/business-news/bethesda-pulls-almost-all-of-its-games-from-nvidias-geforce-now-service/), [Liliputing](https://liliputing.com/2020/04/more-game-publishers-pull-titles-from-nvidias-geforce-game-streaming-platform.html), [TechRadar](https://www.techradar.com/news/nvidia-geforce-now-loses-2k-games-so-you-can-forget-streaming-borderlands), [Laptop Mag: The Long Dark](https://www.laptopmag.com/uk/news/geforce-now-loses-acclaimed-indie-game-in-latest-cloud-gaming-setback)
- Dev và cộng đồng: [itch.io: port Android khó](https://itch.io/post/7572735), [itch.io: không có bản Android](https://itch.io/post/11024199), [itch.io: bản web cho Patreon](https://itch.io/post/11398863), [itch.io: early access trên web](https://itch.io/post/15317370), [itch.io: lý do không đưa debug menu](https://itch.io/post/766928), [itch.io: mã hóa RPG Maker làm game lỗi](https://itch.io/post/8922397), [AkerCheats](https://waldorf.itch.io/akercheats), [Pixel Poppers / RPS: accessibility mods](https://pixelpoppers.com/link/the-modders-creating-accessibility-modes-for-notoriously-difficult-games/the-modders-creating-accessibility-modes-for-notoriously-difficult-games/), [Steam: dev về dịch máy](https://steamcommunity.com/app/1410370/discussions/0/2948125678376403608), [DLsite Translators Unite](https://note.com/dlsite/n/n59164172e4df), [rmvdec](https://github.com/Bioruebe/rmvdec), [JoiPlay rời Google Play (androidphoria)](https://androidphoria.com/tutoriales/joiplay-en-android-que-es-donde-se-descarga-y-como-se-usa), [JoiPlay setup guide](https://retrohandheldhq.com/posts/joiplay-setup-guide/)

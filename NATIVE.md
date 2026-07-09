# CloudsCode 네이티브 앱 (iOS/Android) 셋업

현재 웹앱(PWA)을 **Capacitor**로 감싸 스토어에 올린다. 웹 코드(`public/`)를 100% 재사용하고,
네이티브 기능(ATT 동의·푸시·위젯)만 추가한다.

> 아래 명령은 **Mac + Xcode**(iOS)와 Android Studio(안드로이드)에서 실행. 이 저장소엔 설정·훅만 들어있다.

## 0. 준비물
- Apple Developer 계정 ($99/년), Google Play Developer ($25 1회)
- Mac + Xcode (또는 Codemagic/EAS 같은 클라우드 빌드 — Mac 없이도 가능)
- `capacitor.config.json` 의 `appId`(`com.cloudscode.app`)를 실제 번들 ID로 확정

## 1. 설치 & 플랫폼 추가
```bash
npm install
npx cap init CloudsCode com.cloudscode.app --web-dir=public   # 이미 config 있으면 생략
npx cap add ios
npx cap add android
npx cap sync
```
`webDir: public` 라서 프론트가 앱에 번들된다. API는 `app.js`의 `API_BASE`(Render 도메인)로 절대호출하도록 이미 처리됨. **배포 도메인 바뀌면 `API_BASE` 한 줄만 수정.**

## 2. ATT — 광고추적 동의 (iOS, IDFA 수집의 합법 조건)
```bash
npm i @capacitor-community/app-tracking-transparency
npx cap sync
```
`ios/App/App/Info.plist` 에 사용 목적 문구 추가:
```xml
<key>NSUserTrackingUsageDescription</key>
<string>맞춤 광고와 사용 통계를 위해 기기의 광고 식별자를 사용합니다.</string>
```
- 앱 시작 시 `initNative()`(app.js)가 ATT 팝업을 띄운다. **"허용"** 시에만 IDFA 수집 → 합법.
- 거부하면 IDFA는 0으로 나오며, 그래도 앱은 정상 동작.

## 3. 위치 권한 문구 (Info.plist)
```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>현재 위치의 공항·날씨·활주로 정보를 보여주기 위해 위치를 사용합니다.</string>
```
> ⚠️ 한국 출시 시 **위치기반서비스사업 신고**(방통위/KISA, 개시 1개월 내) 별도 진행.

## 4. 푸시 알림 (기상특보 알림)
```bash
npm i @capacitor/push-notifications
npx cap sync
```
- Apple: **APNs 인증키(.p8)** 발급(Keys → Apple Push Notifications service) → 서버에서 발송.
- `initNative()`가 권한 요청 + 등록을 처리. 등록 토큰은 `registration` 이벤트로 받아 서버에 저장.
- 발송 로직(서버): 기상특보 감지 → 해당 지역 구독 토큰에 APNs/FCM 전송. (다음 단계에서 서버에 붙임)

## 5. iOS 위젯 (WidgetKit)
위젯은 **네이티브 Swift(WidgetKit)** 이라 웹으로 못 만든다. 스타터가 `native/ios-widget/`에 있다.
1. Xcode → File → New → Target → **Widget Extension** (이름: `CloudsCodeWidget`)
2. 생성된 파일을 `native/ios-widget/CloudsCodeWidget.swift` 내용으로 교체
3. **App Group** 설정(앱·위젯 데이터 공유): 앱/위젯 타깃 모두 `group.com.cloudscode.app` 추가
4. 앱에서 최신 날씨를 App Group `UserDefaults(suiteName:)`에 저장 → 위젯이 읽음
   (Capacitor `Preferences` 플러그인 또는 소량 네이티브 브릿지로 기록)

## 6. 빌드 & 제출
```bash
npx cap sync
npx cap open ios      # Xcode에서 서명·아카이브·App Store Connect 업로드
npx cap open android  # Android Studio에서 서명·번들(aab) 업로드
```
- App Store: 스크린샷, 개인정보 라벨(위치·식별자·사용데이터), 심사. **가이드 4.2** 대비 → 푸시·위젯·ATT가 네이티브 가치.
- 재배포: 웹 고치고 `npx cap sync` → 다시 아카이브.

## 웹은 그대로 유지
`API_BASE`·`initNative()`·플러그인 호출은 모두 **웹에선 무시**되도록 가드됨. 즉 지금처럼 웹앱도 계속 동작.

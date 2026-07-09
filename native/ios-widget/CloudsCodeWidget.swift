// CloudsCodeWidget — WidgetKit (iOS)
// 항덕 감성의 '계기판' 위젯: ICAO 코드 · 기온 · 바람(화살표+속도) · 활주로 · METAR 원문.
// 데이터는 App Group UserDefaults(group.com.cloudscode.app)에서 앱이 써둔 값을 읽는다.
//
// 설치: Xcode → Widget Extension 타깃 생성 후 이 파일로 교체. 앱/위젯 타깃에 App Group 추가.

import WidgetKit
import SwiftUI

// MARK: - 데이터 모델 (앱이 App Group에 저장한 스냅샷)
struct WxSnapshot {
    var icao: String
    var airport: String
    var temp: String        // "24°"
    var windDeg: Double      // 바람이 불어오는 방향(도)
    var windText: String     // "북북서 9kt"
    var runway: String       // "RWY 15"
    var metar: String        // 원문 한 줄
    var updated: String      // "10:31"

    static let placeholder = WxSnapshot(
        icao: "RKSI", airport: "인천", temp: "24°", windDeg: 330,
        windText: "북북서 9kt", runway: "RWY 15",
        metar: "RKSI 081200Z 33009KT 9999 FEW030 24/18 Q1013", updated: "10:31")

    static func load() -> WxSnapshot {
        let d = UserDefaults(suiteName: "group.com.cloudscode.app")
        guard let d = d, let icao = d.string(forKey: "icao") else { return .placeholder }
        return WxSnapshot(
            icao: icao,
            airport: d.string(forKey: "airport") ?? "",
            temp: d.string(forKey: "temp") ?? "—",
            windDeg: d.double(forKey: "windDeg"),
            windText: d.string(forKey: "windText") ?? "—",
            runway: d.string(forKey: "runway") ?? "",
            metar: d.string(forKey: "metar") ?? "",
            updated: d.string(forKey: "updated") ?? "")
    }
}

// MARK: - Timeline
struct WxEntry: TimelineEntry { let date: Date; let snap: WxSnapshot }

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> WxEntry { WxEntry(date: Date(), snap: .placeholder) }
    func getSnapshot(in context: Context, completion: @escaping (WxEntry) -> Void) {
        completion(WxEntry(date: Date(), snap: WxSnapshot.load()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<WxEntry>) -> Void) {
        let entry = WxEntry(date: Date(), snap: WxSnapshot.load())
        // 30분마다 갱신
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date())!
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

// MARK: - 디자인 토큰 (앱과 통일)
private let ink = Color.white
private let inkSoft = Color.white.opacity(0.62)
private let accent = Color(red: 0.44, green: 0.71, blue: 1.0)
private let bg = LinearGradient(
    colors: [Color(red: 0.04, green: 0.06, blue: 0.09), Color(red: 0.06, green: 0.09, blue: 0.14)],
    startPoint: .top, endPoint: .bottom)

// 바람 화살표 (불어오는 방향에서 → 중심으로)
struct WindArrow: View {
    let deg: Double
    var body: some View {
        Image(systemName: "location.north.fill")
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(accent)
            .rotationEffect(.degrees(deg + 180)) // 불어오는 방향 → 향하는 방향
    }
}

// MARK: - Small
struct SmallView: View {
    let s: WxSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(s.icao).font(.system(size: 15, weight: .heavy, design: .monospaced)).foregroundStyle(accent)
                Spacer()
                Text(s.temp).font(.system(size: 17, weight: .heavy)).foregroundStyle(ink)
            }
            Spacer(minLength: 0)
            HStack(spacing: 6) {
                WindArrow(deg: s.windDeg)
                Text(s.windText).font(.system(size: 13, weight: .semibold)).foregroundStyle(ink).lineLimit(1)
            }
            Text(s.runway).font(.system(size: 13, weight: .bold, design: .monospaced)).foregroundStyle(accent)
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(bg)
    }
}

// MARK: - Medium
struct MediumView: View {
    let s: WxSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(s.icao).font(.system(size: 18, weight: .heavy, design: .monospaced)).foregroundStyle(accent)
                Text(s.airport).font(.system(size: 13, weight: .semibold)).foregroundStyle(inkSoft)
                Spacer()
                Text(s.temp).font(.system(size: 22, weight: .heavy)).foregroundStyle(ink)
            }
            HStack(spacing: 10) {
                HStack(spacing: 6) { WindArrow(deg: s.windDeg)
                    Text(s.windText).font(.system(size: 14, weight: .semibold)).foregroundStyle(ink) }
                Text("·").foregroundStyle(inkSoft)
                Text(s.runway).font(.system(size: 14, weight: .bold, design: .monospaced)).foregroundStyle(accent)
            }
            Spacer(minLength: 0)
            // METAR 원문 — 모노스페이스 '계기판' 라인
            Text(s.metar)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(inkSoft).lineLimit(2)
                .padding(.vertical, 6).padding(.horizontal, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.06)))
            Text("updated \(s.updated)").font(.system(size: 10)).foregroundStyle(inkSoft.opacity(0.7))
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(bg)
    }
}

// MARK: - Widget
struct CloudsCodeWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    var entry: Provider.Entry
    var body: some View {
        switch family {
        case .systemSmall: SmallView(s: entry.snap)
        default: MediumView(s: entry.snap)
        }
    }
}

@main
struct CloudsCodeWidget: Widget {
    let kind = "CloudsCodeWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            if #available(iOS 17.0, *) {
                CloudsCodeWidgetEntryView(entry: entry).containerBackground(.clear, for: .widget)
            } else {
                CloudsCodeWidgetEntryView(entry: entry)
            }
        }
        .configurationDisplayName("CloudsCode")
        .description("가까운 공항의 바람·활주로·METAR를 한눈에.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

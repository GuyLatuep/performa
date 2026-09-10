---
name: apple-design-language
description: Apple-native visual language (HIG-derived design tokens, layout rules, and anti-patterns) for cross-platform apps built with Flutter, React Native, or Tauri. Use this skill for ANY UI work in this project — new screens, components, refactors, styling changes, or design review — even when the request does not mention Apple, iOS, HIG, or design at all. If you are about to pick a color, font size, radius, spacing value, or animation curve, consult this skill first.
---

# Apple Design Language (Cross-Platform)

The goal is an interface that a longtime iOS user would recognize as native-feeling:
restrained, content-first, systematic. Not "glassy" or "premium-looking" — **quiet**.

If a choice is not covered here, ask: *what would the iOS Settings app do?*

---

## Non-negotiable legal constraints

Do NOT use these, ever, in this project:

- **SF Pro / SF Compact / New York fonts** — licensed for Apple platforms only. Not for
  Android, Windows, Linux, or web. Do not bundle the OTF files. Do not `@font-face` them.
- **SF Symbols** — same restriction. Do not export or reimplement the glyphs.

Use the fallbacks in the Typography and Icons sections instead.

---

## 1. Typography

### Font stack

```
Apple platforms:  system font via platform API (see per-stack notes below)
Everywhere else:  Inter  →  system-ui  →  sans-serif
```

Never introduce a second display font. No Poppins, Montserrat, Space Grotesk, Nunito,
or anything with visible personality. The type does not perform; the content does.

Enable Inter's `cv11` and `ss01` OpenType features if available — they bring the
single-storey `a`/`g` closer to SF's construction.

### Scale (points/dp; matches iOS default Dynamic Type)

| Style        | Size | Line height | Weight   | Tracking (approx.) |
|--------------|------|-------------|----------|--------------------|
| Large Title  | 34   | 41          | Regular  | +0.37              |
| Title 1      | 28   | 34          | Regular  | +0.36              |
| Title 2      | 22   | 28          | Regular  | −0.26              |
| Title 3      | 20   | 25          | Regular  | −0.45              |
| Headline     | 17   | 22          | Semibold | −0.43              |
| Body         | 17   | 22          | Regular  | −0.43              |
| Callout      | 16   | 21          | Regular  | −0.31              |
| Subheadline  | 15   | 20          | Regular  | −0.23              |
| Footnote     | 13   | 18          | Regular  | −0.08              |
| Caption 1    | 12   | 16          | Regular  |  0                 |
| Caption 2    | 11   | 13          | Regular  | +0.06              |

Tracking values are close approximations of Apple's optical-size compensation, not exact
figures. The rule that matters: **tighten between 15 and 22, loosen slightly above 28,
leave small text alone.**

Rules:
- Body text is 17, not 16. This single value does more for the "iOS feel" than anything else.
- Weight carries hierarchy, size carries hierarchy. Color does not — never use a colored
  heading to signal importance.
- Only three weights exist in this project: Regular (400), Medium (500), Semibold (600).
  No Bold(700)+ except in a Large Title, and only if the design specifically calls for it.

---

## 2. Color

Semantic names only. Never hardcode a hex in a component — reference the token.

### Accent (pick exactly ONE for the whole app)

| Token       | Light     | Dark      |
|-------------|-----------|-----------|
| systemBlue  | `#007AFF` | `#0A84FF` |
| systemGreen | `#34C759` | `#30D158` |
| systemRed   | `#FF3B30` | `#FF453A` |
| systemOrange| `#FF9500` | `#FF9F0A` |
| systemIndigo| `#5856D6` | `#5E5CE6` |
| systemPurple| `#AF52DE` | `#BF5AF2` |
| systemTeal  | `#30B0C7` | `#40C8E0` |
| systemPink  | `#FF2D55` | `#FF375F` |

`systemRed` is reserved for destructive actions regardless of the chosen accent.

### Text

| Token           | Light                     | Dark                          |
|-----------------|---------------------------|-------------------------------|
| label           | `#000000`                 | `#FFFFFF`                     |
| secondaryLabel  | `rgba(60,60,67,0.60)`     | `rgba(235,235,245,0.60)`      |
| tertiaryLabel   | `rgba(60,60,67,0.30)`     | `rgba(235,235,245,0.30)`      |
| quaternaryLabel | `rgba(60,60,67,0.18)`     | `rgba(235,235,245,0.16)`      |

Note these are **alpha over the background**, not solid grays. That is why they work on
both white and colored surfaces.

### Surfaces

| Token                          | Light     | Dark      |
|--------------------------------|-----------|-----------|
| systemBackground               | `#FFFFFF` | `#000000` |
| secondarySystemBackground      | `#F2F2F7` | `#1C1C1E` |
| tertiarySystemBackground       | `#FFFFFF` | `#2C2C2E` |
| systemGroupedBackground        | `#F2F2F7` | `#000000` |
| secondarySystemGroupedBackground | `#FFFFFF` | `#1C1C1E` |
| separator                      | `rgba(60,60,67,0.29)` | `rgba(84,84,88,0.65)` |
| opaqueSeparator                | `#C6C6C8` | `#38383A` |

### Grays

`systemGray` `#8E8E93` (identical in both modes), then Gray2–Gray6:
light `#AEAEB2 #C7C7CC #D1D1D6 #E5E5EA #F2F2F7`,
dark `#636366 #48484A #3A3A3C #2C2C2E #1C1C1E`.

Dark mode is **not** an inversion. It is a separate token set — build both from day one.

---

## 3. Spacing and layout

Base grid: **8pt**, with 4pt allowed for optical fine-tuning only.

- Screen horizontal margin: **16** on phones, **20** on tablets/desktop.
- Minimum tap target: **44 × 44**. No exceptions, including icon-only buttons.
- Minimum list row height: **44**.
- Gap between grouped list sections: **35** (this odd number is the real iOS value).
- Vertical rhythm inside a card: 12 between related items, 24 between groups.

**The grouped-inset list is the default layout primitive.** Not cards floating on a
canvas — rounded sections sitting on `systemGroupedBackground`, with hairline separators
between rows that are inset to align with the row's text, not the section edge.

Row anatomy (memorize this): leading icon or nothing → label → flexible space →
secondary value in `secondaryLabel` → chevron. Never center-align row content.

---

## 4. Corners

Apple uses **continuous curvature** (squircles), not circular arcs. A plain
`border-radius: 16px` reads subtly wrong at large radii — the corner "kinks" where the
straight edge meets the arc.

Radii:
- Inline controls, chips, small inputs: **8–10**
- Cards, grouped list sections: **12–16**
- Sheets, large containers: **16–26**
- Prominent buttons: **capsule** (fully rounded) — this is the current iOS default
- Nested elements: **concentric** — inner radius = outer radius − padding

The squircle matters most above ~12. Below that, ship the plain radius and move on.
Per-stack implementation notes are in section 7.

---

## 5. Motion

Apple animates with **springs**, not duration curves. Anything with `ease-in-out` and a
300ms duration will read as generic.

Defaults:
- Standard state change: spring, ~0.35s settle, no bounce
- Navigation push/pop and sheet present: ~0.45–0.5s, slight overshoot
- Micro-interactions (button press): scale to 0.96, ~0.12s, immediate release

If your stack has no spring primitive, `cubic-bezier(0.32, 0.72, 0, 1)` at 450ms is the
closest approximation to Apple's sheet transition.

Always honor reduced-motion and reduced-transparency settings — replace movement with a
cross-fade, replace blur with an opaque surface.

---

## 6. Materials (optional Liquid Glass layer)

Apple's current design language, Liquid Glass, is a real-time material that reflects and
refracts what sits behind it. **You cannot reproduce refraction outside Apple's renderer.**
Do not claim to. What you can do:

- Backdrop blur, 20–40 radius
- Surface at 60–80% opacity, tinted with the underlying background
- A single 1px top/left highlight edge at ~20% white
- Nothing else. No stacked shadows, no animated gradients, no "shimmer".

Apply it to exactly one class of element — the bottom tab bar or the top navigation bar —
and nowhere else. Glass everywhere is the fastest way to look like a knockoff.

If in doubt, skip it. The flat, structural version of this design language is far easier
to get right and ages better.

---

## 7. Per-stack implementation

Read only the section matching this project's stack.

### Flutter
- System font on Apple: `CupertinoTheme` + default `.SF Pro Text` resolution — do not
  declare the family explicitly, let the platform resolve it. Bundle Inter as the family
  for all other targets and switch via `Platform.isIOS`/`isMacOS`.
- Prefer `Cupertino*` widgets over `Material*`. If a Cupertino equivalent does not exist,
  strip the Material one: `splashFactory: NoSplash.splashFactory`, `elevation: 0`.
- `ContinuousRectangleBorder` is **not** Apple's squircle despite the name. Use the
  `smooth_corner` or `figma_squircle` package for radii above 12.
- Springs: `SpringDescription` with `CupertinoPageTransition` for navigation.
- Blur: `BackdropFilter` with `ImageFilter.blur(sigmaX: 30, sigmaY: 30)`.

### React Native
- System font on Apple: `fontFamily: 'System'`. Load Inter via `expo-font` elsewhere and
  branch on `Platform.OS`.
- Springs: `react-native-reanimated`, `withSpring({ damping: 30, stiffness: 300, mass: 1 })`.
  Do not use `Animated.timing` for anything a user touches.
- Blur: `expo-blur` (`BlurView`, `intensity={40}`) or `@react-native-community/blur`.
- Squircles: `react-native-squircle-view`, or accept the plain radius under 12.
- Never use `elevation` (Android shadow). Use a hairline separator instead.

### Tauri (webview)
- Font: `font-family: system-ui, 'Inter', sans-serif`. On macOS `system-ui` resolves to
  SF Pro legitimately, because the OS provides it — this is the licensed path.
- Squircles: CSS `corner-shape: squircle` where supported (recent Safari/WebKit), plain
  `border-radius` as the fallback. Do not ship an SVG-mask hack.
- Blur: `backdrop-filter: blur(30px) saturate(180%)`.
- Disable text selection and the default focus ring on non-input elements; add
  `-webkit-font-smoothing: antialiased`.
- Set the Tauri window to transparent with a vibrancy/`NSVisualEffectView` background on
  macOS rather than painting a fake one in CSS.

---

## 8. Icons

Use **Lucide** (closest in weight and geometry to SF Symbols) or **Phosphor**. Stroke
width 1.5–2, size 20 or 24, aligned to the 8pt grid, colored with `secondaryLabel` unless
the icon is the interactive element itself.

Never use emoji as UI icons.

---

## 9. Banned patterns

Reject these even if asked casually, and say why:

- Gradient-filled buttons or gradient hero sections
- Stacked or colored `box-shadow`; neumorphism
- Material Design artifacts: ripple, FAB, elevation-based card system, bottom app bar
- More than one accent color in the palette
- Colored text used to indicate hierarchy
- Cards with visible borders where a hairline separator would do
- Center-aligned body text or center-aligned list rows
- Decorative fonts, letter-spaced uppercase headings, all-caps labels
- Uniform `rounded-2xl` applied to everything without a radius system
- Icon-only buttons under 44pt
- Dark mode generated by inverting light mode

---

## 10. Review checklist

Before declaring any UI work done, verify:

1. Body text is 17 and line height is 22.
2. Every color used is a named token from section 2, no raw hex in the component.
3. Dark mode was authored, not derived.
4. Every interactive element is at least 44 × 44.
5. Exactly one accent color appears on the screen.
6. Nothing has a drop shadow.
7. Animations are springs, and reduced-motion is handled.
8. No SF Pro and no SF Symbols anywhere in the repo.
9. The screen would still make sense as a grouped-inset list. If it would not, there is
   probably a reason — check that the reason is a real one.

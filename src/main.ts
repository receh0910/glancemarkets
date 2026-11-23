import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

// GlanceMarkets — prediction markets + crypto prices at a glance on Even G2.
// Track: Crypto & DeFi (Polymarket + CoinGecko, public APIs, no keys).
// Tap: next market · Swipe down: star/unstar · Swipe up: previous · Double-tap: exit.

const bridge = await waitForEvenAppBridge()

interface Market {
  question: string
  yesPct: number
  volume24h: number
}

const FALLBACK: Market[] = [
  { question: 'BTC above $120K by Dec 31?', yesPct: 64, volume24h: 1820000 },
  { question: 'ETH above $5K in November?', yesPct: 41, volume24h: 960000 },
  { question: 'Fed rate cut in December?', yesPct: 78, volume24h: 2400000 },
]

let markets: Market[] = FALLBACK
let prices: Record<string, number> = { BTC: 0, ETH: 0, SOL: 0 }
let idx = 0
const starred = new Set<number>()

function fmtVol(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function wrap(text: string, width = 34): string {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) {
      lines.push(line.trim())
      line = w
    } else line += ' ' + w
  }
  if (line.trim()) lines.push(line.trim())
  return lines.slice(0, 3).join('\n')
}

function render(): string {
  const i = idx % markets.length
  const m = markets[i]
  const star = starred.has(i) ? ' *' : ''
  const px = `BTC $${prices.BTC.toLocaleString()}  ETH $${prices.ETH.toLocaleString()}  SOL $${prices.SOL.toLocaleString()}`
  return [
    `GLANCEMARKETS  ${i + 1}/${markets.length}${star}`,
    '',
    wrap(m.question),
    '',
    `YES ${m.yesPct.toFixed(0)}%   NO ${(100 - m.yesPct).toFixed(0)}%   Vol ${fmtVol(m.volume24h)}`,
    '',
    px,
    'Tap: next · Swipe: star/prev · 2xTap: exit',
  ].join('\n')
}

const mainText = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 288,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 6,
  containerID: 1,
  containerName: 'main',
  content: 'GlanceMarkets\nLoading markets...',
  isEventCapture: 1,
})

await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [mainText],
  }),
)

let writeChain: Promise<unknown> = Promise.resolve()
function push(): void {
  writeChain = writeChain.then(() =>
    bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 1,
        containerName: 'main',
        content: render(),
      }),
    ),
  )
}

async function refresh(): Promise<void> {
  try {
    const r = await fetch(
      'https://gamma-api.polymarket.com/markets?limit=8&active=true&closed=false&order=volume24hr&ascending=false&tag_id=21',
    )
    const data = (await r.json()) as Array<Record<string, unknown>>
    const parsed: Market[] = data
      .map((d) => {
        let yes = 0
        try {
          const arr = JSON.parse(String(d.outcomePrices ?? '[]')) as string[]
          yes = parseFloat(arr[0] ?? '0') * 100
        } catch { /* keep 0 */ }
        return {
          question: String(d.question ?? ''),
          yesPct: yes,
          volume24h: Number(d.volume24hr ?? 0),
        }
      })
      .filter((m) => m.question && m.yesPct >= 1 && m.yesPct <= 99)
    if (parsed.length) markets = parsed
  } catch { /* keep fallback/last */ }
  try {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd',
    )
    const d = (await r.json()) as Record<string, { usd: number }>
    prices = {
      BTC: d.bitcoin?.usd ?? prices.BTC,
      ETH: d.ethereum?.usd ?? prices.ETH,
      SOL: d.solana?.usd ?? prices.SOL,
    }
  } catch { /* keep last */ }
  push()
}

// CLICK_EVENT is 0 and protobuf omits zero-value fields, so a single tap
// arrives with eventType undefined inside its envelope. Resolve the default
// INSIDE the envelope check (see template notes).
function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

const unsubscribe = bridge.onEvenHubEvent((event) => {
  const sysType = eventTypeOf(event.sysEvent)
  const textType = eventTypeOf(event.textEvent)

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    bridge.shutDownPageContainer(1)
    return
  }
  if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) {
    idx = (idx + 1) % markets.length
    push()
    return
  }
  if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    const i = idx % markets.length
    if (starred.has(i)) starred.delete(i)
    else starred.add(i)
    push()
    return
  }
  if (textType === OsEventTypeList.SCROLL_TOP_EVENT) {
    idx = (idx - 1 + markets.length) % markets.length
    push()
    return
  }
  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    unsubscribe()
  }
})

await refresh()
setInterval(refresh, 30000)

import type { Metadata } from 'next';
import Link from 'next/link';
import { Apple, ArrowRight, Check, Download, Gamepad2, HelpCircle, Menu, Smartphone, Trophy, Users, X } from 'lucide-react';
import { mobileAppConfig, isConfigured } from '@/config/mobile-app';
import './mobile-app.css';

export const metadata: Metadata = {
  title: 'ClutchNex App — Download the Official Android & iOS App',
  description: 'Download the official ClutchNex mobile app for Android and iOS. Follow esports tournaments, matches, rankings and updates from your phone.',
  alternates: { canonical: '/app-download' },
  openGraph: { title: 'ClutchNex Mobile App', description: 'Your esports tournaments, matches and leaderboards — right in your pocket.', type: 'website' },
};

const faqs = [
  ['What is the ClutchNex app?', 'The ClutchNex app is the mobile companion for the ClutchNex esports platform. Use it to follow tournaments, matches, leaderboards and updates from your phone.'],
  ['Is the ClutchNex app free to download?', 'Yes. The official app download is free. Tournament entry rules and fees, where applicable, are shown clearly on the platform.'],
  ['How do I install the Android APK?', 'Download the official APK, open the downloaded file, review Android’s install prompt, then open ClutchNex and sign in. Only install APKs from the official ClutchNex download page.'],
  ['Is ClutchNex available on iOS?', mobileAppConfig.iosUrl ? 'Yes. Download ClutchNex from the official App Store listing.' : 'The iOS listing is being prepared. Check back here for the official App Store link.'],
  ['Do I need a ClutchNex account?', 'Some features may require you to create or sign in to a ClutchNex account. Visit the main platform for account access and tournament participation.'],
];

function Phone({ label, accent = false }: { label: string; accent?: boolean }) {
  return <div className={`ma-phone ${accent ? 'ma-phone-accent' : ''}`} aria-label={`${label} app screen demonstration`}>
    <div className="ma-notch" /><div className="ma-screen"><div className="ma-screen-top"><span>CLUTCHNEX</span><span>•••</span></div><div className="ma-screen-hero"><small>WELCOME BACK</small><strong>Ready to clutch?</strong></div><div className="ma-screen-stat"><span>UPCOMING TOURNAMENTS</span><b>Explore the arena <ArrowRight size={13}/></b></div><div className="ma-screen-cards"><i/><i/><i/></div><div className="ma-screen-nav"><span>⌂</span><span>◈</span><span>♛</span><span>◉</span></div></div></div>
}

function DownloadButton({ kind }: { kind: 'android' | 'ios' }) {
  const url = kind === 'android' ? mobileAppConfig.androidUrl : mobileAppConfig.iosUrl;
  const ready = isConfigured(url);
  return ready ? <a className={`ma-button ${kind === 'ios' ? 'ma-button-ghost' : ''}`} href={url} target="_blank" rel="noreferrer" onClick={() => undefined}>
    {kind === 'android' ? <Download size={18}/> : <Apple size={20}/>}<span><small>{kind === 'android' ? 'ANDROID APK' : 'IPHONE & IPAD'}</small>{kind === 'android' ? 'Download APK' : 'Download for iOS'}</span><ArrowRight size={17}/>
  </a> : <div className="ma-button ma-disabled" aria-disabled="true">{kind === 'android' ? <Download size={18}/> : <Apple size={20}/>}<span><small>{kind === 'android' ? 'ANDROID APK' : 'IPHONE & IPAD'}</small>{kind === 'android' ? 'Download APK' : 'Coming Soon'}</span></div>;
}

export default function MobileAppPage() {
  const jsonLd = [{ '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'ClutchNex', applicationCategory: 'GameApplication', operatingSystem: 'Android, iOS', description: 'Mobile access to ClutchNex esports tournaments, matches and leaderboards.', url: mobileAppConfig.downloadPage }, { '@context': 'https://schema.org', '@type': 'WebSite', name: 'ClutchNex Mobile App', url: mobileAppConfig.downloadPage }];
  return <div className="ma-site">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    <header className="ma-header"><Link href="/app-download" className="ma-logo"><span>C</span> CLUTCH<span>NEX</span></Link><nav><a href="#features">Features</a><a href="#screens">Screens</a><a href="#faq">FAQ</a><a href="#download" className="ma-nav-cta">Download app <ArrowRight size={15}/></a></nav><details className="ma-menu"><summary aria-label="Open menu"><Menu/></summary><div><a href="#features">Features</a><a href="#screens">Screens</a><a href="#faq">FAQ</a><a href="#download">Download app</a></div></details></header>
    <main>
      <section className="ma-hero"><div className="ma-hero-copy"><p className="ma-eyebrow"><span/> OFFICIAL CLUTCHNEX MOBILE APP</p><h1>Your esports.<br/><em>In your pocket.</em></h1><p className="ma-lede">Follow tournaments, matches and leaderboards wherever the game takes you. The official ClutchNex mobile experience, built for competitors.</p><div className="ma-actions"><DownloadButton kind="android"/><DownloadButton kind="ios"/></div><p className="ma-note">Available for Android. iOS availability will be announced here.</p></div><div className="ma-hero-visual"><div className="ma-orbit"/><Phone label="ClutchNex home screen" accent/><Phone label="ClutchNex tournaments screen"/></div></section>
      <section className="ma-proof"><span><Check/> Official ClutchNex app</span><span><Smartphone/> Built for mobile</span><span><Trophy/> Tournaments & rankings</span></section>
      <section id="features" className="ma-section"><div className="ma-section-head"><p className="ma-eyebrow">WHY CLUTCHNEX</p><h2>Everything you need<br/><em>to stay in the game.</em></h2></div><div className="ma-features"><article><Gamepad2/><h3>Join tournaments</h3><p>Discover competitions and keep your next match close at hand.</p></article><article><Trophy/><h3>Track the action</h3><p>Stay on top of match results, tournament progress and rankings.</p></article><article><Users/><h3>Follow your squad</h3><p>Keep your esports experience connected wherever you play.</p></article></div></section>
      <section id="screens" className="ma-showcase"><div className="ma-showcase-copy"><p className="ma-eyebrow">DESIGNED FOR THE CLUTCH</p><h2>A cleaner way to play the <em>arena.</em></h2><p>Focused information, fast access and a mobile-first experience for the ClutchNex community.</p><Link className="ma-text-link" href={mobileAppConfig.mainWebsite}>Visit the tournament platform <ArrowRight size={16}/></Link></div><div className="ma-screen-row"><Phone label="Home screen" accent/><Phone label="Tournament screen"/><Phone label="Leaderboard screen"/></div></section>
      <section className="ma-how"><p className="ma-eyebrow">GET STARTED</p><h2>Three steps to your<br/><em>next clutch.</em></h2><div className="ma-steps"><div><b>01</b><h3>Download the app</h3><p>Choose your platform above and get the official app.</p></div><div><b>02</b><h3>Sign in or create an account</h3><p>Use your ClutchNex account to pick up where you left off.</p></div><div><b>03</b><h3>Follow the action</h3><p>Explore tournaments, matches and leaderboards on the go.</p></div></div></section>
      <section id="download" className="ma-download"><div><p className="ma-eyebrow">CHOOSE YOUR PLATFORM</p><h2>Ready when<br/><em>you are.</em></h2><p>Download the official ClutchNex mobile app.</p></div><div className="ma-download-cards"><div><Smartphone/><h3>Android</h3><p>Official APK download</p><DownloadButton kind="android"/></div><div><Apple/><h3>iOS</h3><p>{mobileAppConfig.iosUrl ? 'Available on the App Store' : 'App Store listing coming soon'}</p><DownloadButton kind="ios"/></div></div></section>
      <section id="faq" className="ma-faq"><div><p className="ma-eyebrow">NEED TO KNOW</p><h2>Questions,<br/><em>answered.</em></h2><HelpCircle size={32}/></div><div>{faqs.map(([q,a]) => <details key={q}><summary>{q}<span>+</span></summary><p>{a}</p></details>)}</div></section>
    </main>
    <footer className="ma-footer"><div><Link href="/app-download" className="ma-logo"><span>C</span> CLUTCH<span>NEX</span></Link><p>Mobile esports experience for tournaments, matches and rankings.</p></div><div className="ma-footer-links"><a href="#features">Features</a><a href="#download">Download</a><a href="#faq">FAQ</a><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div><div className="ma-footer-social">{mobileAppConfig.instagramUrl && <a href={mobileAppConfig.instagramUrl} aria-label="Instagram">Instagram</a>}<a href={mobileAppConfig.mainWebsite}>Main platform <ArrowRight size={14}/></a></div><small>© {new Date().getFullYear()} ClutchNex. All rights reserved.</small></footer>
  </div>;
}

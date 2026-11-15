import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'LiveBoard — A little marker. A bigger conversation.', description: 'Interactive lessons built around the questions that matter. Place a marker, open a conversation, explore together.' };
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="en"><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700&family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400&family=JetBrains+Mono:wght@400;500;600&display=swap"/></head><body>{children}</body></html>}

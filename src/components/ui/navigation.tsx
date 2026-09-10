"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
export function Navigation({ items, children }: { items: { href: string; label: string }[]; children: React.ReactNode }) {
 const pathname = usePathname();
 const [open, setOpen] = useState(false);
 const toggle = useRef<HTMLButtonElement>(null);
 return <aside className="sidebar" onKeyDown={event => { if (event.key === "Escape" && open) { setOpen(false); toggle.current?.focus(); } }}>
  <div className="sidebar-heading"><Link href="/dashboard" className="sidebar-logo" aria-label="Dopamin Cafe dashboard"><span className="sidebar-brand">dopamin<span>.</span></span><span className="sidebar-subtitle">coffee & workspace</span></Link>
  <button ref={toggle} className="nav-toggle" type="button" aria-expanded={open} aria-controls="navigation-panel" onClick={() => setOpen(!open)}>{open ? "Tutup menu" : "Buka menu"}<span aria-hidden="true">{open ? "\u00d7" : "\u2630"}</span></button></div>
  <div id="navigation-panel" className={"navigation-panel" + (open ? " is-open" : "")}>
  <div className="nav-caption">WORKSPACE</div><nav aria-label="Navigasi utama">{items.map(({href,label}) => <Link key={href} href={href} className="nav-link" aria-current={pathname === href || pathname.startsWith(href + "/") ? "page" : undefined} onClick={() => setOpen(false)}><span className="nav-dot" aria-hidden="true"/>{label}</Link>)}</nav>
  <div className="sidebar-user">{children}</div></div>
 </aside>;
}

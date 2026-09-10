import { Children, isValidElement, type ReactNode } from "react";
function hasEmptyBody(children: ReactNode): boolean {
 return Children.toArray(children).some(child => {
  if (!isValidElement<{children?: ReactNode}>(child)) return false;
  if (child.type === "tbody") return Children.toArray(child.props.children).length === 0;
  return hasEmptyBody(child.props.children);
 });
}
export function ResponsiveTable({children, className = "table-wrap"}: {children: ReactNode; className?: string}) {
 return <div className={className}><div className="table-scroll" role="region" aria-label="Tabel data, geser untuk melihat kolom lainnya" tabIndex={0}>{children}</div>{hasEmptyBody(children) && <div className="empty-state" role="status"><strong>Belum ada data</strong><p>Data akan muncul setelah tersedia. Jika menggunakan filter, coba rentang tanggal lain.</p></div>}</div>;
}

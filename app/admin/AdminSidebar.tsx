"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AdminSidebar({
  items,
}: {
  items: Array<{ href: string; label: string }>;
}) {
  const pathname = usePathname();

  return (
    <nav className="space-y-1">
      {items.map((item) => {
        const isActive = pathname === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              isActive
                ? "block rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white"
                : "block rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

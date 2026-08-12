"use client";

import { useState } from "react";
import Link from "next/link";
import { logout } from "@/app/actions/auth";

const LINKS = [
  { href: "/student", label: "首页" },
  { href: "/student/assignments", label: "作业" },
  { href: "/student/exams", label: "考试成绩" },
  { href: "/student/summaries", label: "课后总结" },
];

export function StudentNav({ fullName }: { fullName: string | null }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="border-b border-slate-200">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-6">
          <span className="font-semibold">NingAcademy · 学生端</span>
          <nav className="hidden items-center gap-6 sm:flex">
            {LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="text-sm text-slate-600 hover:text-slate-900">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {fullName ? (
            <Link href="/student" className="hidden text-sm text-slate-600 hover:text-slate-900 sm:inline">
              {fullName}
            </Link>
          ) : null}
          <form action={logout} className="hidden sm:block">
            <button type="submit" className="text-sm text-slate-600 hover:text-slate-900">
              退出登录
            </button>
          </form>
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            className="text-sm text-slate-600 sm:hidden"
            aria-label={open ? "关闭菜单" : "打开菜单"}
          >
            {open ? "✕" : "☰"}
          </button>
        </div>
      </div>
      {open ? (
        <nav className="flex flex-col gap-3 border-t border-slate-200 px-6 py-4 sm:hidden">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              {link.label}
            </Link>
          ))}
          {fullName ? (
            <Link href="/student" onClick={() => setOpen(false)} className="text-sm text-slate-600 hover:text-slate-900">
              {fullName}
            </Link>
          ) : null}
          <form action={logout}>
            <button type="submit" className="text-sm text-slate-600 hover:text-slate-900">
              退出登录
            </button>
          </form>
        </nav>
      ) : null}
    </header>
  );
}

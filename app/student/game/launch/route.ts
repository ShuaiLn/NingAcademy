import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  GAME_LAUNCH_COOKIE,
  GAME_LAUNCH_TICKET_FIELD,
  GAME_LAUNCH_TICKET_PATTERN,
  GAME_LAUNCH_TRANSITION_PATH,
  getGameLaunchExchangeUrl,
} from "@/app/_lib/game-main-site";

const AUTO_SUBMIT_SCRIPT =
  'document.getElementById("game-launch-form").requestSubmit();';
const SCRIPT_HASH = createHash("sha256")
  .update(AUTO_SUBMIT_SCRIPT)
  .digest("base64");

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!
  );
}

function responseHeaders(exchangeUrl: URL | null): HeadersInit {
  const formAction = exchangeUrl ? exchangeUrl.origin : "'none'";
  return {
    "Cache-Control": "no-store, max-age=0, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": [
      "default-src 'none'",
      `script-src 'sha256-${SCRIPT_HASH}'`,
      `form-action ${formAction}`,
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function makeResponse(
  body: string,
  status: number,
  exchangeUrl: URL | null
): NextResponse {
  const response = new NextResponse(body, {
    status,
    headers: responseHeaders(exchangeUrl),
  });
  response.cookies.set(GAME_LAUNCH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: GAME_LAUNCH_TRANSITION_PATH,
    maxAge: 0,
  });
  return response;
}

export function GET(request: NextRequest) {
  const exchangeUrl = getGameLaunchExchangeUrl();
  const ticket = request.cookies.get(GAME_LAUNCH_COOKIE)?.value;

  if (!exchangeUrl || !ticket || !GAME_LAUNCH_TICKET_PATTERN.test(ticket)) {
    return makeResponse(
      "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><meta name=\"referrer\" content=\"no-referrer\"><title>游戏连接已失效</title><body><main><h1>游戏连接已失效</h1><p>请返回作业页面重新进入。</p></main></body></html>",
      exchangeUrl ? 410 : 503,
      exchangeUrl
    );
  }

  const action = escapeHtml(exchangeUrl.toString());
  const launchTicket = escapeHtml(ticket);
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><title>正在进入 NingAcademy 游戏</title></head><body><main><h1>正在安全连接游戏…</h1><form id="game-launch-form" action="${action}" method="post"><input type="hidden" name="${GAME_LAUNCH_TICKET_FIELD}" value="${launchTicket}"><noscript><button type="submit">继续进入游戏</button></noscript></form></main><script>${AUTO_SUBMIT_SCRIPT}</script></body></html>`;

  return makeResponse(html, 200, exchangeUrl);
}

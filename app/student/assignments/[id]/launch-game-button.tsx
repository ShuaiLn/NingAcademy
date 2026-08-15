"use client";

import { useActionState } from "react";
import {
  launchGameAssignment,
  type LaunchGameResult,
} from "@/app/actions/game";

const INITIAL_STATE: LaunchGameResult = { ok: false, error: "" };

export function LaunchGameButton({ assignmentId }: { assignmentId: string }) {
  const action = launchGameAssignment.bind(null, assignmentId);
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-violet-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "正在安全连接…" : "进入游戏"}
      </button>
      {state.error ? (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

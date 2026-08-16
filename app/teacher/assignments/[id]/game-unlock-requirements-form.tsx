"use client";

import { useActionState, useState } from "react";
import {
  updateGameUnlockRequirements,
  type UpdateGameUnlockRequirementsResult,
} from "@/app/actions/game";
import type { GameUnlockCandidate } from "@/app/_lib/game-unlock";

const KIND_LABELS: Record<GameUnlockCandidate["kind"], string> = {
  plain: "普通作业",
  vocabulary: "词汇作业",
  pronunciation: "朗读作业",
};

const INITIAL_STATE: UpdateGameUnlockRequirementsResult = {
  ok: true,
  message: "",
};

export function GameUnlockRequirementsForm({
  assignmentId,
  candidates,
}: {
  assignmentId: string;
  candidates: GameUnlockCandidate[];
}) {
  const [selectedIds, setSelectedIds] = useState(
    candidates.filter((item) => item.selected).map((item) => item.assignableId)
  );
  const action = updateGameUnlockRequirements.bind(null, assignmentId);
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);

  function toggle(id: string) {
    setSelectedIds((values) =>
      values.includes(id) ? values.filter((value) => value !== id) : [...values, id]
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-md border border-violet-200 bg-violet-50 p-4"
    >
      <div>
        <h2 className="font-medium text-violet-900">游戏解锁要求</h2>
        <p className="text-xs text-slate-600">
          每次保存都会生成不可变版本，并立即撤销旧版本的未使用票据和游戏 session。
        </p>
      </div>
      {candidates.length ? (
        candidates.map((item) => (
          <label key={item.assignableId} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={selectedIds.includes(item.assignableId)}
              onChange={() => toggle(item.assignableId)}
            />
            <span>
              <span className="font-medium">{item.title}</span>
              <span className="ml-2 text-xs text-slate-500">{KIND_LABELS[item.kind]}</span>
            </span>
          </label>
        ))
      ) : (
        <p className="text-sm text-slate-500">暂无可选前置作业；保存空列表表示直接解锁。</p>
      )}
      <input
        type="hidden"
        name="requirementAssignableIds"
        value={JSON.stringify(selectedIds)}
      />
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md bg-violet-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "保存中…" : "保存解锁要求"}
      </button>
      {state.ok && state.message ? (
        <p className="text-sm text-green-700" role="status">
          {state.message}
        </p>
      ) : null}
      {!state.ok ? (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

"use client";

import { useActionState, useState } from "react";
import {
  createAndPublishGameAssignment,
  type CreateGameAssignmentResult,
} from "@/app/actions/game";
import { DueDateInput } from "@/app/_components/due-date-input";
import type { GameUnlockCandidate } from "@/app/_lib/game-unlock";

const INITIAL_STATE: CreateGameAssignmentResult = { ok: false, error: "" };

const KIND_LABELS: Record<GameUnlockCandidate["kind"], string> = {
  plain: "普通作业",
  vocabulary: "词汇作业",
  pronunciation: "朗读作业",
};

function toggle(values: string[], id: string): string[] {
  return values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
}

export function CreateGameAssignmentForm({
  classes,
  students,
  vocabularySources,
  unlockCandidates,
}: {
  classes: { id: string; name: string }[];
  students: { id: string; fullName: string }[];
  vocabularySources: { id: string; title: string }[];
  unlockCandidates: GameUnlockCandidate[];
}) {
  const [state, formAction, pending] = useActionState(
    createAndPublishGameAssignment,
    INITIAL_STATE
  );
  const [classIds, setClassIds] = useState<string[]>([]);
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [requirementIds, setRequirementIds] = useState<string[]>([]);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">游戏作业标题</span>
        <input
          name="title"
          type="text"
          maxLength={200}
          required
          className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">说明（可选）</span>
        <textarea
          name="description"
          rows={3}
          maxLength={2000}
          className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
        />
      </label>
      <DueDateInput />

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
          <legend className="px-1 text-sm font-medium text-slate-700">指定班级</legend>
          {classes.length ? (
            classes.map((item) => (
              <label key={item.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={classIds.includes(item.id)}
                  onChange={() => setClassIds((values) => toggle(values, item.id))}
                />
                {item.name}
              </label>
            ))
          ) : (
            <p className="text-sm text-slate-400">还没有班级。</p>
          )}
        </fieldset>
        <fieldset className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
          <legend className="px-1 text-sm font-medium text-slate-700">指定学生</legend>
          {students.length ? (
            students.map((item) => (
              <label key={item.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={studentIds.includes(item.id)}
                  onChange={() => setStudentIds((values) => toggle(values, item.id))}
                />
                {item.fullName}
              </label>
            ))
          ) : (
            <p className="text-sm text-slate-400">还没有学生。</p>
          )}
        </fieldset>
      </div>

      <fieldset className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
        <legend className="px-1 text-sm font-medium text-slate-700">游戏题目词库</legend>
        <p className="text-xs text-slate-500">至少选择一个已发布词库，供权威游戏服务器生成学习题。</p>
        {vocabularySources.length ? (
          vocabularySources.map((item) => (
            <label key={item.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sourceIds.includes(item.id)}
                onChange={() => setSourceIds((values) => toggle(values, item.id))}
              />
              {item.title}
            </label>
          ))
        ) : (
          <p className="text-sm text-amber-700">请先发布至少一个词汇作业。</p>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2 rounded-md border border-violet-200 bg-violet-50 p-4">
        <legend className="px-1 text-sm font-medium text-violet-800">进入 Games 前必须完成</legend>
        <p className="text-xs text-slate-600">
          不选择表示无需前置作业。游戏作业本身不会出现在这里，避免循环依赖。
        </p>
        {unlockCandidates.length ? (
          unlockCandidates.map((item) => (
            <label key={item.assignableId} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={requirementIds.includes(item.assignableId)}
                onChange={() =>
                  setRequirementIds((values) => toggle(values, item.assignableId))
                }
              />
              <span>
                <span className="font-medium">{item.title}</span>
                <span className="ml-2 text-xs text-slate-500">{KIND_LABELS[item.kind]}</span>
              </span>
            </label>
          ))
        ) : (
          <p className="text-sm text-slate-500">暂无已发布的前置作业候选。</p>
        )}
      </fieldset>

      <input type="hidden" name="classIds" value={JSON.stringify(classIds)} />
      <input type="hidden" name="studentIds" value={JSON.stringify(studentIds)} />
      <input
        type="hidden"
        name="vocabularySourceIds"
        value={JSON.stringify(sourceIds)}
      />
      <input
        type="hidden"
        name="requirementAssignableIds"
        value={JSON.stringify(requirementIds)}
      />

      <button
        type="submit"
        disabled={pending || vocabularySources.length === 0}
        className="w-fit rounded-md bg-violet-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "发布中…" : "发布游戏作业"}
      </button>
      {state.error ? (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

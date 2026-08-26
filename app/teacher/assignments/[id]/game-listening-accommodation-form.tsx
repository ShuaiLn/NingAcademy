"use client";

import { useActionState, useState } from "react";
import {
  setGameListeningAccommodation,
  type SetGameListeningAccommodationResult,
} from "@/app/actions/game";

type StudentOption = { id: string; fullName: string };
type ListeningAccommodation = {
  studentId: string;
  listeningMode: string;
  worldAudioEffectsEnabled: boolean;
};

const INITIAL_STATE: SetGameListeningAccommodationResult = {
  ok: true,
  message: "",
};

export function GameListeningAccommodationForm({
  assignmentId,
  students,
  accommodations,
}: {
  assignmentId: string;
  students: StudentOption[];
  accommodations: ListeningAccommodation[];
}) {
  const firstStudentId = students[0]?.id ?? "";
  const firstAccommodation = accommodations.find(
    (item) => item.studentId === firstStudentId
  );
  const [studentId, setStudentId] = useState(firstStudentId);
  const [listeningMode, setListeningMode] = useState(
    firstAccommodation?.listeningMode ?? "audio"
  );
  const [worldAudioEffectsEnabled, setWorldAudioEffectsEnabled] = useState(
    firstAccommodation?.worldAudioEffectsEnabled ?? true
  );
  const action = setGameListeningAccommodation.bind(null, assignmentId);
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);

  function chooseStudent(nextStudentId: string) {
    const accommodation = accommodations.find(
      (item) => item.studentId === nextStudentId
    );
    setStudentId(nextStudentId);
    setListeningMode(accommodation?.listeningMode ?? "audio");
    setWorldAudioEffectsEnabled(
      accommodation?.worldAudioEffectsEnabled ?? true
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-md border border-violet-200 bg-violet-50 p-4"
    >
      <div>
        <h2 className="font-medium text-violet-900">听力与音效辅助</h2>
        <p className="text-xs text-slate-600">
          设置由服务器冻结到学生的新游戏尝试中。学生端不能自行切换为文字替代。
        </p>
      </div>
      {students.length ? (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">学生</span>
            <select
              name="studentId"
              value={studentId}
              onChange={(event) => chooseStudent(event.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2"
            >
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.fullName || student.id}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="font-medium">听力题呈现方式</legend>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="listeningMode"
                value="audio"
                checked={listeningMode === "audio"}
                onChange={() => setListeningMode("audio")}
              />
              <span>正常听力音频（1× 播放）</span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="listeningMode"
                value="text_alternative"
                checked={listeningMode === "text_alternative"}
                onChange={() => setListeningMode("text_alternative")}
              />
              <span>
                经审核文字替代（仍计为题目且沿用相同截止时间；不会显示答案）
              </span>
            </label>
          </fieldset>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="worldAudioEffectsEnabled"
              checked={worldAudioEffectsEnabled}
              onChange={(event) =>
                setWorldAudioEffectsEnabled(event.target.checked)
              }
            />
            <span>保留世界音效（取消勾选会冻结为 effects-disabled 模式）</span>
          </label>
          <button
            type="submit"
            disabled={pending}
            className="w-fit rounded-md bg-violet-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? "保存中…" : "保存听力辅助设置"}
          </button>
        </>
      ) : (
        <p className="text-sm text-slate-500">暂无可设置的学生。</p>
      )}
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

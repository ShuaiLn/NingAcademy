import { createClient } from "@/utils/supabase/server";
import { WordForm } from "./_components/word-form";
import { WordCard } from "./_components/word-card";

export default async function PersonalEnglishPage() {
  const supabase = await createClient();
  const { data: words, error } = await supabase
    .from("personal_words")
    .select("id, term, meaning")
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">生词库</h1>
        <p className="mt-1 text-sm text-slate-500">
          记录你想记住的英文单词和短语。
        </p>
      </div>

      <WordForm />

      <section aria-labelledby="personal-word-list-heading">
        <h2 id="personal-word-list-heading" className="mb-3 font-medium">
          我的生词
        </h2>
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            生词加载失败，请稍后重试。
          </p>
        ) : words?.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {words.map((word) => (
              <WordCard key={word.id} word={word} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">还没有生词，先添加一个吧。</p>
        )}
      </section>
    </div>
  );
}

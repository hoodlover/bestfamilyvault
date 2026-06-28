export function EggsStep({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-stone-800 bg-stone-900/50 p-5 md:p-6">
      <h2 className="flex items-center gap-3 text-lg md:text-xl font-bold text-stone-100 mb-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-700/20 border border-emerald-600/40 text-emerald-300 text-sm font-bold shrink-0">
          10
        </span>
        Useful extras
      </h2>
      <div className="text-sm md:text-base text-stone-300 leading-relaxed pl-11">
        {children}
      </div>
    </section>
  )
}

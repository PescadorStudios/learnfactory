"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Sparkles, ArrowRight, BookOpen, BrainCircuit } from "lucide-react";

export default function Home() {
  const [topic, setTopic] = useState("");
  const router = useRouter();

  const examples = [
    "Inteligencia Artificial",
    "Storytelling",
    "Medicina funcional",
    "Ventas B2B",
    "Griego bíblico",
    "Producción de video",
  ];

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;
    router.push(`/sources?topic=${encodeURIComponent(topic)}`);
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-secondary/20 blur-[120px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="w-full max-w-2xl z-10 flex flex-col items-center text-center"
      >
        <div className="flex items-center gap-2 mb-6 bg-zinc-900/50 border border-zinc-800 px-4 py-2 rounded-full text-zinc-400 text-sm">
          <Sparkles className="w-4 h-4 text-primary" />
          <span>Tu academia personalizada impulsada por IA</span>
        </div>

        <h1 className="text-5xl md:text-7xl font-bold mb-6 tracking-tight">
          ¿Qué quieres <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">dominar?</span>
        </h1>
        
        <p className="text-zinc-400 text-lg mb-12 max-w-xl">
          LearnFactory genera rutas de aprendizaje adaptativas, microlecciones y simulaciones para que domines cualquier tema del mundo real.
        </p>

        <form onSubmit={handleStart} className="w-full relative max-w-xl mb-10">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Ej: Teología del pacto, Bitcoin, Finanzas..."
            className="w-full bg-zinc-900/80 border border-zinc-800 rounded-2xl py-4 pl-6 pr-16 text-lg text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all shadow-2xl"
          />
          <button
            type="submit"
            disabled={!topic.trim()}
            className="absolute right-2 top-2 bottom-2 bg-primary hover:bg-primary-hover text-white rounded-xl px-4 flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
          >
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>
        </form>

        <div className="flex flex-wrap items-center justify-center gap-3 max-w-lg">
          <span className="text-zinc-500 text-sm mr-2 w-full mb-2">Sugerencias populares:</span>
          {examples.map((ex, i) => (
            <motion.button
              key={ex}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3 + i * 0.1 }}
              onClick={() => setTopic(ex)}
              className="px-4 py-2 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm hover:bg-zinc-800 hover:text-white transition-colors flex items-center gap-2"
            >
              {i % 2 === 0 ? <BrainCircuit className="w-3 h-3 text-secondary" /> : <BookOpen className="w-3 h-3 text-accent" />}
              {ex}
            </motion.button>
          ))}
        </div>
      </motion.div>
    </main>
  );
}

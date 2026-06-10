"use server";

// Server actions invocadas en vivo durante las lecciones.
// La generación de contenido pregenerado vive en routeActions.ts + lib/generation.ts.

import { getUserFromToken } from "@/lib/supabase/admin";
import { evaluateSocraticAnswerCore, debateTurnCore } from "@/lib/generation";
import type { Sintesis, SocraticEvaluation, DebateMessage, DebateTurnResult } from "@/lib/types";

export async function evaluateSocraticAnswer(
  token: string,
  question: string,
  userAnswer: string,
  conceptContext: string
): Promise<SocraticEvaluation> {
  const user = await getUserFromToken(token);
  if (!user) {
    return { puntuacion: 0, fortalezas: [], mejoras: ["Sesión inválida: vuelve a iniciar sesión."], ideaClave: "" };
  }
  return evaluateSocraticAnswerCore(question, userAnswer, conceptContext);
}

export async function debateTurn(
  token: string,
  topic: string,
  nodeTitle: string,
  sintesis: Sintesis,
  transcript: DebateMessage[]
): Promise<DebateTurnResult> {
  const user = await getUserFromToken(token);
  if (!user) {
    return { mensajeIA: "Sesión inválida: vuelve a iniciar sesión.", esCierre: true };
  }
  return debateTurnCore(topic, nodeTitle, sintesis, transcript);
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBciOperator } from "@/lib/bci/operator-access";

async function db() {
  return requireBciOperator();
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function createCase(formData: FormData) {
  const { supabase, user } = await db();
  const title = text(formData, "title");
  const question = text(formData, "question");
  if (!title || !question) redirect("/?error=case_required");

  const { data, error } = await supabase.from("cases").insert({
    title, question, owner_id: user.id, status: "open"
  }).select("id").single();

  if (error || !data) redirect("/?error=case_create");
  redirect("/cases/" + data.id);
}

export async function createEvidence(formData: FormData) {
  const { supabase } = await db();
  const caseId = text(formData, "case_id");
  const source = text(formData, "source");
  const subject = text(formData, "subject");
  const content = text(formData, "content");
  if (!caseId || !source || !content) return;
  const { data } = await supabase.from("evidence").insert({ source, subject: subject || null, content }).select("id").single();
  if (data) await supabase.from("case_evidence").upsert({ case_id: caseId, evidence_id: data.id });
  revalidatePath("/cases/" + caseId);
}

export async function createSignal(formData: FormData) {
  const { supabase } = await db();
  const caseId = text(formData, "case_id");
  const title = text(formData, "title");
  const description = text(formData, "description");
  const significance = text(formData, "significance");
  if (!caseId || !title) return;
  const { data } = await supabase.from("signals").insert({ title, description: description || null, significance: significance || null }).select("id").single();
  if (data) await supabase.from("case_signals").upsert({ case_id: caseId, signal_id: data.id });
  revalidatePath("/cases/" + caseId);
}

export async function createDiagnosis(formData: FormData) {
  const { supabase } = await db();
  const caseId = text(formData, "case_id");
  if (!caseId) return;
  await supabase.from("diagnoses").insert({
    case_id: caseId,
    observed_facts: text(formData, "observed_facts"),
    hypotheses: text(formData, "hypotheses"),
    supporting_evidence: text(formData, "supporting_evidence"),
    contradicting_evidence: text(formData, "contradicting_evidence"),
    uncertainty: text(formData, "uncertainty")
  });
  revalidatePath("/cases/" + caseId);
}

export async function createDecision(formData: FormData) {
  const { supabase, user } = await db();
  const caseId = text(formData, "case_id");
  if (!caseId || !text(formData, "decision")) return;
  await supabase.from("decisions").insert({
    case_id: caseId,
    decision: text(formData, "decision"),
    rationale: text(formData, "rationale"),
    assumptions: text(formData, "assumptions"),
    decision_owner: user.id
  });
  revalidatePath("/cases/" + caseId);
}

export async function createAction(formData: FormData) {
  const { supabase } = await db();
  const caseId = text(formData, "case_id");
  const decisionId = text(formData, "decision_id");
  if (!caseId || !decisionId || !text(formData, "title")) return;
  await supabase.from("actions").insert({
    decision_id: decisionId,
    title: text(formData, "title"),
    description: text(formData, "description"),
    due_at: text(formData, "due_at") || null
  });
  revalidatePath("/cases/" + caseId);
}

// Outcomes are observations, not proof that implementation finished or that
// a business result is independently verified.
export async function createOutcome(formData: FormData) {
  const { supabase } = await db();
  const caseId = text(formData, "case_id");
  const actionId = text(formData, "action_id");
  const result = text(formData, "result");
  if (!caseId || !actionId || !result) return;

  // Reject forged or stale form IDs from another case before writing.
  const { data: action, error: actionError } = await supabase.from("actions")
    .select("decision_id").eq("id", actionId).maybeSingle();
  if (actionError || !action) return;
  const { data: decision, error: decisionError } = await supabase.from("decisions")
    .select("id").eq("id", action.decision_id).eq("case_id", caseId).maybeSingle();
  if (decisionError || !decision) return;

  const { error } = await supabase.from("outcomes").insert({ action_id: actionId, result });
  if (!error) revalidatePath("/cases/" + caseId);
}

// This is an explicit, self-reported implementation state transition.
// It must never be used to certify sales, attribution, evidence or ROI.
export async function markImplementationCompleted(formData: FormData) {
  const { supabase } = await db();
  const caseId = text(formData, "case_id");
  const actionId = text(formData, "action_id");
  if (!caseId || !actionId) return;

  const { data: action, error: actionError } = await supabase.from("actions")
    .select("decision_id,status").eq("id", actionId).maybeSingle();
  if (actionError || !action || action.status === "completed") return;
  const { data: decision, error: decisionError } = await supabase.from("decisions")
    .select("id").eq("id", action.decision_id).eq("case_id", caseId).maybeSingle();
  if (decisionError || !decision) return;

  const { error } = await supabase.from("actions")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", actionId).eq("decision_id", action.decision_id);
  if (!error) revalidatePath("/cases/" + caseId);
}

export async function createLearning(formData: FormData) {
  const { supabase } = await db();
  const caseId = text(formData, "case_id");
  const outcomeId = text(formData, "outcome_id");
  if (!caseId || !text(formData, "title") || !text(formData, "learning")) return;
  await supabase.from("learnings").insert({
    outcome_id: outcomeId || null,
    title: text(formData, "title"),
    learning: text(formData, "learning"),
    confidence: text(formData, "confidence") || null
  });
  revalidatePath("/cases/" + caseId);
}

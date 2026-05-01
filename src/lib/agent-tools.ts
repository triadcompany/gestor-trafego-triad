import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { fetchCampaigns, fetchAdSets, getMetaToken, updateMetaObject, createCampaignFromScratch } from "./meta";
import { fetchClients, fetchTasks, createTask, updateTask, createNote, updateClientPix } from "./queries";

export type JsonArgs = Record<string, string | number | boolean | null | undefined>;

// ── Tool definitions (OpenAI format) ─────────────────────────────────────────

export const TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_clients_overview",
      description: "Lista todos os clientes ativos com métricas de hoje (CPL, spend, leads) e indica quais estão com CPL acima da meta.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_client_campaigns",
      description: "Retorna as campanhas de um cliente com gasto, leads e CPL do período.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "ID do cliente no sistema" },
          date_preset: {
            type: "string",
            enum: ["today", "yesterday", "this_week_mon_today", "last_week_mon_sun", "this_month"],
            description: "Período de análise. Padrão: today.",
          },
        },
        required: ["client_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ad_sets",
      description: "Retorna os ad sets de uma campanha específica.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "ID da campanha Meta" },
        },
        required: ["campaign_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_tasks",
      description: "Lista tarefas do sistema com filtro opcional por status.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["pendente", "em_andamento", "concluida", "all"],
            description: "Filtro de status. Padrão: all.",
          },
        },
        required: [],
      },
    },
  },
  // Fase 2 — write tools (sempre retornam confirmation_required)
  {
    type: "function",
    function: {
      name: "update_ad_budget",
      description: "Altera o orçamento diário de um ad set. SEMPRE requer confirmação do usuário antes de executar.",
      parameters: {
        type: "object",
        properties: {
          ad_set_id: { type: "string", description: "ID do ad set Meta" },
          ad_set_name: { type: "string", description: "Nome legível do ad set" },
          daily_budget_brl: { type: "number", description: "Novo orçamento diário em R$" },
          current_budget_brl: { type: "number", description: "Orçamento atual em R$ (para exibir na confirmação)" },
          client_name: { type: "string", description: "Nome do cliente (para exibir na confirmação)" },
        },
        required: ["ad_set_id", "ad_set_name", "daily_budget_brl", "client_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pause_campaign",
      description: "Pausa uma campanha Meta. SEMPRE requer confirmação do usuário antes de executar.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "ID da campanha Meta" },
          campaign_name: { type: "string", description: "Nome legível da campanha" },
          client_name: { type: "string", description: "Nome do cliente" },
        },
        required: ["campaign_id", "campaign_name", "client_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "activate_campaign",
      description: "Ativa uma campanha Meta pausada. SEMPRE requer confirmação do usuário antes de executar.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "ID da campanha Meta" },
          campaign_name: { type: "string", description: "Nome legível da campanha" },
          client_name: { type: "string", description: "Nome do cliente" },
        },
        required: ["campaign_id", "campaign_name", "client_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_task",
      description: "Cria uma tarefa no sistema. SEMPRE requer confirmação do usuário antes de executar.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Título da tarefa" },
          status: { type: "string", enum: ["pendente", "em_andamento"], description: "Status inicial. Padrão: pendente." },
          due_date: { type: "string", description: "Data de vencimento no formato YYYY-MM-DD (opcional)" },
          client_id: { type: "string", description: "ID do cliente vinculado (opcional)" },
          client_name: { type: "string", description: "Nome do cliente (para exibir na confirmação)" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_task_status",
      description: "Atualiza o status de uma tarefa existente. SEMPRE requer confirmação do usuário antes de executar.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "ID da tarefa" },
          task_title: { type: "string", description: "Título da tarefa (para exibir na confirmação)" },
          new_status: { type: "string", enum: ["pendente", "em_andamento", "concluida"] },
        },
        required: ["task_id", "task_title", "new_status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_note",
      description: "Cria uma anotação vinculada a um cliente. SEMPRE requer confirmação do usuário antes de executar.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "ID do cliente" },
          client_name: { type: "string", description: "Nome do cliente (para exibir na confirmação)" },
          content: { type: "string", description: "Conteúdo da anotação" },
        },
        required: ["client_id", "client_name", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_client_pix",
      description: "Configura ou atualiza a cobrança PIX de um cliente (orçamento mensal, ciclo e dia de referência). SEMPRE requer confirmação do usuário antes de executar.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "ID do cliente" },
          client_name: { type: "string", description: "Nome do cliente (para exibir na confirmação)" },
          pix_active: { type: "boolean", description: "Ativar ou desativar cobrança PIX" },
          monthly_budget: { type: "number", description: "Orçamento mensal em R$" },
          pix_cycle: {
            type: "string",
            enum: ["semanal", "quinzenal", "mensal"],
            description: "Ciclo de cobrança PIX",
          },
          pix_reference_day: { type: "number", description: "Dia de referência para cobrança (1-31)" },
        },
        required: ["client_id", "client_name", "pix_active"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_campaign",
      description: "Cria uma campanha Meta Ads (campanha + ad set, pausados) para um cliente. O criativo deve ser adicionado depois no Ads Manager. SEMPRE requer confirmação do usuário antes de executar.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "ID do cliente no sistema" },
          client_name: { type: "string", description: "Nome do cliente (para exibir na confirmação)" },
          campaign_name: { type: "string", description: "Nome da campanha" },
          daily_budget_brl: { type: "number", description: "Orçamento diário em R$" },
          campaign_type: {
            type: "string",
            enum: ["engagement", "sales"],
            description: "Tipo: engagement (OUTCOME_ENGAGEMENT) ou sales (OUTCOME_SALES). Padrão: engagement.",
          },
          placements: {
            type: "string",
            enum: ["facebook", "instagram", "ambos"],
            description: "Onde veicular os anúncios. Padrão: ambos.",
          },
          age_min: { type: "number", description: "Idade mínima do público (padrão: 18)" },
          age_max: { type: "number", description: "Idade máxima do público (padrão: 65)" },
          gender: {
            type: "string",
            enum: ["all", "male", "female"],
            description: "Gênero do público. Padrão: all.",
          },
        },
        required: ["client_id", "client_name", "campaign_name", "daily_budget_brl"],
      },
    },
  },
];

// ── Write tools — actions que precisam de confirmação ─────────────────────────

export const WRITE_TOOLS = new Set([
  "update_ad_budget",
  "pause_campaign",
  "activate_campaign",
  "create_task",
  "update_task_status",
  "create_note",
  "update_client_pix",
  "create_campaign",
]);

// ── Tool execution ────────────────────────────────────────────────────────────

export type ToolResult =
  | { type: "result"; data: unknown }
  | { type: "error"; message: string };

export async function executeTool(
  name: string,
  args: JsonArgs
): Promise<ToolResult> {
  try {
    switch (name) {
      case "get_clients_overview": {
        const clients = await fetchClients();
        return {
          type: "result",
          data: clients.map((c) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            cpl_today: c.cplToday,
            cpl_max: c.cpl_max,
            spend_today: c.spendToday,
            leads_today: c.leadsToday,
            above_target: c.cplToday !== null && c.cplToday > c.cpl_max,
          })),
        };
      }

      case "get_client_campaigns": {
        const clients = await fetchClients();
        const client = clients.find((c) => c.id === args.client_id);
        if (!client) return { type: "error", message: "Cliente não encontrado." };
        const token = await getMetaToken();
        if (!token) return { type: "error", message: "Token Meta não configurado." };
        const datePreset = (args.date_preset as string | undefined) ?? "today";
        const campaigns = await fetchCampaigns(
          client.meta_ad_account_id,
          token,
          datePreset as import("./meta").DatePreset
        );
        return { type: "result", data: campaigns };
      }

      case "get_ad_sets": {
        const token = await getMetaToken();
        if (!token) return { type: "error", message: "Token Meta não configurado." };
        const adSets = await fetchAdSets(args.campaign_id as string, token);
        return { type: "result", data: adSets };
      }

      case "list_tasks": {
        const tasks = await fetchTasks();
        const status = args.status as string | undefined;
        const filtered =
          !status || status === "all"
            ? tasks
            : tasks.filter((t) => t.status === status);
        return { type: "result", data: filtered };
      }

      default:
        return { type: "error", message: `Ferramenta desconhecida: ${name}` };
    }
  } catch (err) {
    return { type: "error", message: err instanceof Error ? err.message : "Erro desconhecido." };
  }
}

// Executa uma write tool após confirmação do usuário
export async function executeConfirmedAction(
  name: string,
  args: JsonArgs
): Promise<ToolResult> {
  try {
    switch (name) {
      case "update_ad_budget": {
        const token = await getMetaToken();
        if (!token) return { type: "error", message: "Token Meta não configurado." };
        const budgetCents = Math.round((args.daily_budget_brl as number) * 100);
        await updateMetaObject(args.ad_set_id as string, { daily_budget: String(budgetCents) }, token);
        return { type: "result", data: { success: true } };
      }

      case "pause_campaign": {
        const token = await getMetaToken();
        if (!token) return { type: "error", message: "Token Meta não configurado." };
        await updateMetaObject(args.campaign_id as string, { status: "PAUSED" }, token);
        return { type: "result", data: { success: true } };
      }

      case "activate_campaign": {
        const token = await getMetaToken();
        if (!token) return { type: "error", message: "Token Meta não configurado." };
        await updateMetaObject(args.campaign_id as string, { status: "ACTIVE" }, token);
        return { type: "result", data: { success: true } };
      }

      case "create_task": {
        await createTask({
          title: args.title as string,
          status: (args.status as "pendente" | "em_andamento") ?? "pendente",
          due_date: (args.due_date as string | null) ?? null,
          client_id: (args.client_id as string | null) ?? null,
        });
        return { type: "result", data: { success: true } };
      }

      case "update_task_status": {
        await updateTask(args.task_id as string, {
          status: args.new_status as "pendente" | "em_andamento" | "concluida",
        });
        return { type: "result", data: { success: true } };
      }

      case "create_note": {
        await createNote({
          client_id: args.client_id as string,
          content: args.content as string,
        });
        return { type: "result", data: { success: true } };
      }

      case "create_campaign": {
        const token = await getMetaToken();
        if (!token) return { type: "error", message: "Token Meta não configurado." };
        const clients = await fetchClients();
        const client = clients.find((c) => c.id === args.client_id);
        if (!client) return { type: "error", message: "Cliente não encontrado." };
        if (!client.meta_page_id) return { type: "error", message: `Cliente "${client.name}" não tem Page ID configurado. Edite o cadastro do cliente.` };
        if (!client.meta_whatsapp_number) return { type: "error", message: `Cliente "${client.name}" não tem WhatsApp Business configurado. Edite o cadastro do cliente.` };

        const placements = (args.placements as string | undefined) ?? "ambos";
        const result = await createCampaignFromScratch({
          name: args.campaign_name as string,
          adAccountId: client.meta_ad_account_id,
          pageId: client.meta_page_id,
          whatsappNumber: client.meta_whatsapp_number,
          dailyBudget: args.daily_budget_brl as number,
          campaignType: (args.campaign_type as "engagement" | "sales") ?? "engagement",
          placements: {
            facebook: placements === "facebook" || placements === "ambos",
            instagram: placements === "instagram" || placements === "ambos",
          },
          targeting: {
            ageMin: args.age_min as number | undefined,
            ageMax: args.age_max as number | undefined,
            genderMode: (args.gender as "all" | "male" | "female") ?? "all",
          },
          token,
        });
        return { type: "result", data: { campaignId: result.campaignId, adSetId: result.adSetId } };
      }

      case "update_client_pix": {
        await updateClientPix(args.client_id as string, {
          pix_active: args.pix_active as boolean,
          monthly_budget: args.monthly_budget as number ?? null,
          pix_cycle: (args.pix_cycle as "semanal" | "quinzenal" | "mensal") ?? null,
          pix_reference_day: args.pix_reference_day as number ?? null,
        });
        return { type: "result", data: { success: true } };
      }

      default:
        return { type: "error", message: `Ação desconhecida: ${name}` };
    }
  } catch (err) {
    return { type: "error", message: err instanceof Error ? err.message : "Erro ao executar ação." };
  }
}

// Gera descrição legível de uma write tool para exibir no card de confirmação
export function describeAction(name: string, args: JsonArgs): string {
  switch (name) {
    case "update_ad_budget":
      return `Alterar orçamento do ad set "${args.ad_set_name}" de R$ ${args.current_budget_brl ?? "?"} → R$ ${args.daily_budget_brl}/dia (${args.client_name})`;
    case "pause_campaign":
      return `Pausar campanha "${args.campaign_name}" (${args.client_name})`;
    case "activate_campaign":
      return `Ativar campanha "${args.campaign_name}" (${args.client_name})`;
    case "create_task":
      return `Criar tarefa: "${args.title}"${args.client_name ? ` — ${args.client_name}` : ""}${args.due_date ? ` · Prazo: ${args.due_date}` : ""}`;
    case "update_task_status":
      return `Atualizar tarefa "${args.task_title}" → ${args.new_status}`;
    case "create_note":
      return `Criar anotação em ${args.client_name}: "${String(args.content).slice(0, 80)}${String(args.content).length > 80 ? "..." : ""}"`;
    case "create_campaign": {
      const placements = args.placements ?? "ambos";
      const type = args.campaign_type === "sales" ? "Vendas" : "Engajamento";
      return `Criar campanha "${args.campaign_name}" para ${args.client_name} · R$ ${args.daily_budget_brl}/dia · ${type} · ${placements} (pausada, sem criativo)`;
    }
    case "update_client_pix": {
      const status = args.pix_active ? "ativar" : "desativar";
      const details = args.pix_active
        ? ` · R$ ${args.monthly_budget}/mês · ciclo ${args.pix_cycle} · dia ${args.pix_reference_day}`
        : "";
      return `${status.charAt(0).toUpperCase() + status.slice(1)} PIX de ${args.client_name}${details}`;
    }
    default:
      return `Executar: ${name}`;
  }
}

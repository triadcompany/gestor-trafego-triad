import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeText,
  matchRule,
  extractBrlAmount,
  buildEventId,
  clampEventTime,
  META_EVENT_NAME,
  type KeywordRule,
} from "./keyword-match.ts";

const rule = (over: Partial<KeywordRule> = {}): KeywordRule => ({
  id: "r1",
  eventType: "purchase",
  keyword: "Negócio Fechado",
  keywordNormalized: "negocio fechado",
  source: "team",
  defaultValue: null,
  active: true,
  ...over,
});

describe("normalizeText", () => {
  it("tira acento, caixa e espaços repetidos", () => {
    assert.equal(normalizeText("  NEGÓCIO   Fechado! "), "negocio fechado!");
  });
  it("string vazia continua vazia", () => {
    assert.equal(normalizeText("   "), "");
  });
});

describe("matchRule", () => {
  it("acha por 'contém', ignorando acento e caixa", () => {
    const r = matchRule([rule()], "purchase", "Show! NEGOCIO FECHADO, valeu", true);
    assert.equal(r?.id, "r1");
  });
  it("não acha quando o texto não contém", () => {
    assert.equal(matchRule([rule()], "purchase", "oi tudo bem", true), null);
  });
  it("source team só vale pra mensagem da equipe", () => {
    assert.equal(matchRule([rule({ source: "team" })], "purchase", "negocio fechado", false), null);
    assert.ok(matchRule([rule({ source: "team" })], "purchase", "negocio fechado", true));
  });
  it("source lead só vale pra mensagem do lead", () => {
    assert.ok(matchRule([rule({ source: "lead" })], "purchase", "negocio fechado", false));
    assert.equal(matchRule([rule({ source: "lead" })], "purchase", "negocio fechado", true), null);
  });
  it("source any vale pros dois", () => {
    assert.ok(matchRule([rule({ source: "any" })], "purchase", "negocio fechado", true));
    assert.ok(matchRule([rule({ source: "any" })], "purchase", "negocio fechado", false));
  });
  it("ignora regra inativa e regra de outro tipo", () => {
    assert.equal(matchRule([rule({ active: false })], "purchase", "negocio fechado", true), null);
    assert.equal(matchRule([rule({ eventType: "qualified_lead" })], "purchase", "negocio fechado", true), null);
  });
  it("texto vazio não bate", () => {
    assert.equal(matchRule([rule()], "purchase", "  ", true), null);
  });
  it("com várias regras devolve a primeira que bate", () => {
    const rules = [rule({ id: "a", keywordNormalized: "pix" }), rule({ id: "b", keywordNormalized: "negocio fechado" })];
    assert.equal(matchRule(rules, "purchase", "negocio fechado, pix recebido", true)?.id, "a");
  });
});

describe("extractBrlAmount", () => {
  const cases: Array<[string, number | null]> = [
    ["Pix de R$ 1.500,00 recebido", 1500],
    ["valor R$1", 1],
    ["R$ 1500", 1500],
    ["R$ 12,5", 12.5],
    ["R$1.500", 1500],
    ["r$ 20", 20],
    ["sem valor nenhum aqui", null],
    ["me chama no 11 99999-8888", null],
    ["entrada R$ 200 e R$ 300 depois", 200],
  ];
  for (const [text, expected] of cases) {
    it(`"${text}" -> ${expected}`, () => {
      assert.equal(extractBrlAmount(text), expected);
    });
  }
});

describe("buildEventId e nomes", () => {
  it("é determinístico por lead e tipo", () => {
    assert.equal(buildEventId("abc", "purchase"), "abc:purchase");
    assert.equal(buildEventId("abc", "purchase"), buildEventId("abc", "purchase"));
    assert.notEqual(buildEventId("abc", "qualified"), buildEventId("abc", "lead"));
  });
  it("nomes de evento da Meta", () => {
    assert.equal(META_EVENT_NAME.qualified, "QualifiedLead");
    assert.equal(META_EVENT_NAME.lead, "LeadSubmitted");
    assert.equal(META_EVENT_NAME.purchase, "Purchase");
  });
});

describe("clampEventTime", () => {
  const now = Date.UTC(2026, 10, 17, 12, 0, 0);
  it("mantém horário recente", () => {
    const t = now - 3600 * 1000;
    assert.equal(clampEventTime(t, now), Math.floor(t / 1000));
  });
  it("usa agora quando passou de 7 dias", () => {
    assert.equal(clampEventTime(now - 8 * 24 * 3600 * 1000, now), Math.floor(now / 1000));
  });
  it("usa agora quando está no futuro", () => {
    assert.equal(clampEventTime(now + 5000, now), Math.floor(now / 1000));
  });
  it("usa agora quando o valor é inválido", () => {
    assert.equal(clampEventTime(Number.NaN, now), Math.floor(now / 1000));
  });
});

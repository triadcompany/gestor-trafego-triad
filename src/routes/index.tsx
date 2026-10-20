import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  LayoutGrid,
  Upload,
  Clock,
  ArrowUpRight,
  Heart,
  Sparkles,
  Target,
  CheckCircle2,
  Zap,
  Plus,
} from "lucide-react";
import { AppSimulator } from "@/components/landing/AppSimulator";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Triad Gestor — gestão de tráfego numa tela só" },
      {
        name: "description",
        content:
          "Centralize campanhas, vendas, rastreamento de leads e relatórios automáticos de todos os seus clientes Meta Ads numa única tela. Planos a partir de R$ 129/mês.",
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;1,500&display=swap",
      },
    ],
  }),
  component: LandingPage,
});

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || !("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, visible };
}

function Reveal({
  children,
  className = "",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      id={id}
      className={`motion-safe:transition-[opacity,transform] motion-safe:duration-700 motion-safe:ease-out ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
      } ${className}`}
    >
      {children}
    </div>
  );
}

function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled((window.scrollY || window.pageYOffset || 0) > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return scrolled;
}

function LandingPage() {
  const scrolled = useScrolled();

  return (
    <div
      className="min-h-screen w-full overflow-x-hidden"
      style={
        {
          "--teal": "#2DD4BF",
          "--teal-ink": "#0B1C1A",
          "--teal-dim": "rgba(45,212,191,0.12)",
          "--amber": "#FBBF24",
          "--amber-dim": "rgba(251,191,36,0.14)",
          "--lp-bg": "#1C1C1F",
          "--lp-bg-deep": "#131315",
          "--lp-card": "#202023",
          "--lp-card-2": "#25252A",
          "--lp-border": "rgba(255,255,255,0.08)",
          "--lp-border-strong": "rgba(255,255,255,0.16)",
          "--lp-text": "#F3F3F1",
          "--lp-muted": "#A6A5AB",
          "--lp-muted-2": "#8C8B92",
          background: "var(--lp-bg)",
          color: "var(--lp-text)",
          fontFamily: "'DM Sans',system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
        } as React.CSSProperties
      }
    >
      {/* NAV */}
      <header
        className={`sticky top-0 z-40 transition-[background-color,border-color,backdrop-filter] duration-300 ${
          scrolled ? "backdrop-blur-xl border-b border-[var(--lp-border)]" : "border-b border-transparent"
        }`}
        style={scrolled ? { backgroundColor: "rgba(19,19,21,0.82)" } : undefined}
      >
        <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-6 px-6 py-4">
          <a href="#top" className="flex items-center gap-2.5 text-[17px] font-extrabold">
            <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-[var(--teal)] text-[15px] font-extrabold text-[var(--teal-ink)]">
              TG
            </span>
            <span className="hidden min-[420px]:inline">
              Triad <span className="text-[var(--teal)]">Gestor</span>
            </span>
          </a>
          <nav className="hidden items-center gap-8 text-sm text-[var(--lp-muted)] md:flex">
            <a href="#beneficios" className="transition-colors hover:text-[var(--lp-text)]">Benefícios</a>
            <a href="#rastreamento" className="transition-colors hover:text-[var(--lp-text)]">Rastreamento</a>
            <a href="#como-funciona" className="transition-colors hover:text-[var(--lp-text)]">Como funciona</a>
            <a href="#planos" className="transition-colors hover:text-[var(--lp-text)]">Planos</a>
            <a href="#faq" className="transition-colors hover:text-[var(--lp-text)]">Dúvidas</a>
          </nav>
          <div className="flex items-center gap-2.5">
            <Link
              to="/login"
              className="inline-flex items-center justify-center rounded-[10px] border border-[var(--lp-border-strong)] px-[18px] py-2.5 text-sm font-bold transition-colors hover:border-[var(--teal)] hover:text-[var(--teal)]"
            >
              Entrar
            </Link>
            <a
              href="#planos"
              className="inline-flex items-center justify-center rounded-[10px] bg-[var(--teal)] px-[18px] py-2.5 text-sm font-bold text-[var(--teal-ink)] transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-6px_rgba(0,0,0,0.5)]"
            >
              Ver planos
            </a>
          </div>
        </div>
      </header>

      <main id="top">
        <Hero />
        <Pains />
        <Features />
        <Tracking />
        <Simulator />
        <HowItWorks />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>

      <footer className="border-t border-[var(--lp-border)] px-6 py-9">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 text-sm font-bold text-[var(--lp-muted)]">
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-md bg-[var(--teal)] text-[11px] font-extrabold text-[var(--teal-ink)]">
              TG
            </span>
            Triad Gestor
          </div>
          <p className="text-[13px] text-[var(--lp-muted-2)]">© 2026 Triad Gestor. Todos os direitos reservados.</p>
        </div>
      </footer>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-card)] p-4 text-left transition-[transform,border-color,background-color] duration-300 hover:-translate-y-1 hover:border-[var(--lp-border-strong)] hover:bg-[var(--lp-card-2)]">
      <p className="text-xs text-[var(--lp-muted)]">{label}</p>
      <p className="mt-1.5 text-xl font-extrabold md:text-2xl">{value}</p>
      {sub && <p className="mt-1 text-xs text-[var(--lp-muted-2)]" style={{ fontFamily: "'DM Mono',monospace" }}>{sub}</p>}
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden px-6 py-16 md:py-24">
      <div
        className="absolute left-1/2 top-[-180px] h-[520px] w-[520px] -translate-x-[60%] rounded-full opacity-[0.16] blur-[90px] motion-safe:animate-[drift_16s_ease-in-out_infinite]"
        style={{ background: "var(--teal)" }}
        aria-hidden
      />
      <div
        className="absolute right-[-120px] top-[120px] h-[420px] w-[420px] rounded-full opacity-10 blur-[90px] motion-safe:animate-[drift_16s_ease-in-out_infinite_-6s]"
        style={{ background: "var(--amber)" }}
        aria-hidden
      />
      <div className="relative mx-auto flex max-w-[860px] flex-col items-center gap-7 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--lp-border)] bg-[var(--lp-card)] py-1.5 pl-1.5 pr-3.5 text-[13px] text-[var(--lp-muted)]">
          <span
            className="rounded-full px-2.5 py-0.5 text-xs font-bold text-[var(--teal)]"
            style={{ background: "var(--teal-dim)", fontFamily: "'DM Mono',monospace" }}
          >
            NOVO
          </span>
          Agente de IA que mexe nas campanhas por você
        </div>
        <h1 className="text-balance text-[34px] font-extrabold leading-[1.08] tracking-[-0.02em] md:text-[58px]">
          Sua gestão de tráfego, <span className="text-[var(--teal)]">numa tela só.</span>
        </h1>
        <p className="max-w-[640px] text-[16px] leading-relaxed text-[var(--lp-muted)] md:text-[19px]">
          Gerencie campanhas, contas de anúncio, vendas e WhatsApp de todos os seus clientes, gestor autônomo ou
          agência, sem trocar de aba, sem perder venda no caminho.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-3.5">
          <a
            href="#planos"
            className="inline-flex items-center justify-center rounded-[10px] bg-[var(--teal)] px-7 py-4 text-base font-bold text-[var(--teal-ink)] transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-6px_rgba(0,0,0,0.5)]"
          >
            Ver planos e preços
          </a>
          <a
            href="#beneficios"
            className="inline-flex items-center justify-center rounded-[10px] border border-[var(--lp-border-strong)] px-7 py-4 text-base font-bold transition-colors hover:border-[var(--teal)] hover:text-[var(--teal)]"
          >
            Ver o que o sistema faz
          </a>
        </div>
      </div>

      <Reveal className="relative mx-auto mt-16 max-w-[980px] overflow-hidden rounded-[20px] border border-[var(--lp-border-strong)] bg-[var(--lp-bg-deep)] shadow-[0_40px_90px_-30px_rgba(0,0,0,0.6)]">
        <div className="flex items-center gap-2 border-b border-[var(--lp-border)] px-[18px] py-3.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#FF5F57]" />
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#FEBC2E]" />
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#28C840]" />
          <span
            className="ml-3.5 min-w-0 overflow-hidden whitespace-nowrap text-ellipsis text-xs text-[var(--lp-muted-2)]"
            style={{ fontFamily: "'DM Mono',monospace" }}
          >
            gestor.triadcomp4ny.com.br/clients
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 p-5 md:grid-cols-4">
          <StatTile label="Conversas iniciadas" value="420" sub="Gerenciador de Anúncios" />
          <StatTile label="Custo por conversa" value="R$ 5,80" sub="CCI" />
          <StatTile label="Leads" value="356" sub="Chegou no WhatsApp" />
          <StatTile label="Custo por lead" value="R$ 6,85" sub="Lead de verdade" />
          <StatTile label="Qualificados" value="142" />
          <StatTile label="Custo por lead qualificado" value="R$ 17,18" />
          <StatTile label="Vendas" value="23" />
          <StatTile label="Valor vendido" value="R$ 287.500" />

          <div className="col-span-2 mt-0.5 rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-card)] p-6 text-left md:col-span-4">
            <p className="mb-5 text-[15px] font-bold">Funil de conversão</p>
            <div className="relative">
              <svg viewBox="0 0 900 160" className="block w-full" aria-hidden="true">
                <defs>
                  <linearGradient id="funnelGradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#7DEDDD" />
                    <stop offset="100%" stopColor="#245C54" />
                  </linearGradient>
                </defs>
                <polygon
                  points="0,10 225,20.5 450,56.5 675,73 900,73 900,87 675,87 450,103.5 225,139.5 0,150"
                  fill="url(#funnelGradient)"
                />
              </svg>
              {[
                { left: "25%", label: "85%" },
                { left: "50%", label: "40%" },
                { left: "75%", label: "16%" },
              ].map((m) => (
                <span
                  key={m.left}
                  className="absolute top-1/2 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-[var(--lp-border-strong)] bg-[var(--lp-bg-deep)] px-2.5 py-1 text-xs font-bold"
                  style={{ left: m.left }}
                >
                  <ArrowUpRight className="h-2.5 w-2.5" />
                  {m.label}
                </span>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-y-2.5 md:grid-cols-4">
              {[
                ["Conversas iniciadas", "420"],
                ["Leads", "356"],
                ["Leads qualificados", "142"],
                ["Vendas", "23"],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-xs text-[var(--lp-muted)]">{label}</p>
                  <p className="mt-1 text-[17px] font-extrabold">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

const PAINS = [
  "Cada cliente numa aba diferente do Gerenciador de Anúncios, e você troca de login o dia inteiro.",
  "Relatório pro cliente é copiar número de métrica e colar no WhatsApp, toda semana, na mão.",
  "Fechou a venda? Ninguém avisa o grupo, ninguém sabe quanto custou aquela venda de verdade.",
  "Saldo da conta de anúncio só descobre que acabou quando a campanha já parou de rodar.",
];

function Pains() {
  return (
    <Reveal className="border-t border-[var(--lp-border)] px-6 py-14 md:py-20">
      <div className="mx-auto max-w-[820px]">
        <h2 className="max-w-[460px] text-[26px] font-extrabold tracking-[-0.02em] md:text-[38px]">
          Se isso aqui parece familiar...
        </h2>
        <div className="mt-9 flex flex-col">
          {PAINS.map((pain, i) => (
            <div
              key={pain}
              className={`group flex items-baseline gap-7 border-t border-[var(--lp-border)] py-[26px] px-1 transition-transform duration-[250ms] hover:translate-x-2.5 ${
                i === PAINS.length - 1 ? "border-b" : ""
              }`}
            >
              <span className="w-[30px] shrink-0 text-2xl font-extrabold text-[var(--amber)]">✕</span>
              <p className="text-[17px] leading-relaxed transition-colors group-hover:text-[var(--teal)] md:text-xl">
                {pain}
              </p>
            </div>
          ))}
        </div>
      </div>
    </Reveal>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  desc,
  span,
  tall,
  tint,
}: {
  icon: typeof LayoutGrid;
  title: string;
  desc: string;
  span?: "wide" | "tall";
  tall?: boolean;
  tint?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-[26px] transition-[transform,border-color,background-color] duration-300 hover:-translate-y-1 ${
        tint
          ? "border-transparent"
          : "border-[var(--lp-border)] bg-[var(--lp-card)] hover:border-[var(--lp-border-strong)] hover:bg-[var(--lp-card-2)]"
      } ${span === "wide" ? "md:col-span-2" : ""} ${tall ? "md:col-span-2 md:row-span-2" : ""}`}
      style={tint ? { background: "var(--amber-dim)" } : undefined}
    >
      {tall ? (
        <div className="flex h-full flex-col">
          <Icon className="mb-[18px] h-[30px] w-[30px] text-[var(--teal)]" strokeWidth={1.8} />
          <h3 className="mb-2.5 text-[22px] font-bold">{title}</h3>
          <p className="max-w-[360px] text-[15px] leading-relaxed text-[var(--lp-muted)]">{desc}</p>
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-3">
            <Icon className="h-[22px] w-[22px] shrink-0" style={{ color: tint ? "var(--amber)" : "var(--teal)" }} strokeWidth={2} />
            <h3 className="text-[16px] font-bold md:text-[17px]">{title}</h3>
          </div>
          <p className="text-sm leading-relaxed text-[var(--lp-muted)]">{desc}</p>
        </>
      )}
    </div>
  );
}

function Features() {
  return (
    <Reveal id="beneficios" className="border-t border-[var(--lp-border)] px-6 py-16 md:py-24">
      <div className="mx-auto max-w-[1180px]">
        <div className="mx-auto mb-[52px] max-w-[620px] text-center">
          <h2 className="mb-3.5 text-[26px] font-extrabold tracking-[-0.02em] md:text-[38px]">
            Tudo que você precisa pra rodar tráfego
          </h2>
          <p className="text-base leading-relaxed text-[var(--lp-muted)]">
            Não é mais um dashboard genérico. É feito pra quem vive dentro do Gerenciador de Anúncios o dia inteiro.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-[18px] md:grid-cols-4 md:auto-rows-[minmax(120px,auto)]">
          <FeatureCard
            icon={LayoutGrid}
            title="Todos os clientes, uma tela"
            desc="Veja status, gasto e resultado de cada conta de anúncio sem trocar de login nem abrir vinte abas. É a primeira coisa que você abre de manhã."
            tall
          />
          <FeatureCard
            icon={Upload}
            title="Importa direto do Facebook"
            desc="Conecte sua conta e o sistema já sugere cliente, página e WhatsApp, você só confere e importa."
            span="wide"
          />
          <FeatureCard
            icon={Clock}
            title="Relatório no automático"
            desc="Toda semana, no grupo certo do WhatsApp, sem você copiar nada."
          />
          <FeatureCard
            icon={ArrowUpRight}
            title="Do clique à venda"
            desc="CPL, lead qualificado e custo por venda — o que realmente virou cliente."
          />
          <FeatureCard
            icon={Heart}
            title='Marcou a venda, o grupo já sabe'
            desc="Um clique registra a venda e avisa sozinho o investimento e as conversas que geraram aquela venda."
            span="wide"
          />
          <FeatureCard
            icon={Sparkles}
            title="Agente de IA nas campanhas"
            desc="Peça pro agente pausar uma campanha, ajustar orçamento ou analisar o desempenho, direto pelo chat."
            span="wide"
            tint
          />
        </div>
      </div>
    </Reveal>
  );
}

function Tracking() {
  const steps = [
    {
      icon: Target,
      tag: "RASTREIO",
      title: "Toda mensagem nasce com origem",
      desc: "Cada contato que chega pelo WhatsApp já sai marcado com a campanha, o conjunto e o anúncio exatos que geraram aquele clique.",
    },
    {
      icon: CheckCircle2,
      tag: "QUALIFICAÇÃO",
      title: "Qualificou? A Meta fica sabendo",
      desc: "Quando o gestor marca o lead como qualificado no WhatsApp, o sistema manda esse evento de volta pra Meta na hora.",
    },
    {
      icon: Zap,
      tag: "OTIMIZAÇÃO",
      title: "O algoritmo aprende sozinho",
      desc: "Com um sinal real de qualidade, a Meta entrega o anúncio pra mais gente parecida com quem qualificou de verdade, não só com quem clicou.",
    },
  ];

  return (
    <Reveal id="rastreamento" className="border-t border-[var(--lp-border)] px-6 py-16 md:py-24" >
      <div className="mx-auto max-w-[1100px]" style={{ background: "var(--lp-bg-deep)" }}>
        <div className="mx-auto mb-12 max-w-[700px] text-center">
          <h2 className="mb-3.5 text-[26px] font-extrabold tracking-[-0.02em] md:text-[38px]">
            Mais do que contar lead: ensinar a Meta a achar o lead certo
          </h2>
          <p className="text-base leading-relaxed text-[var(--lp-muted)]">
            A maioria das ferramentas só mostra quantas mensagens chegaram. Esse sistema identifica quem virou lead
            qualificado de verdade e devolve esse dado pra Meta, pra campanha aprender sozinha a buscar mais gente
            assim.
          </p>
        </div>

        <div className="relative">
          <div
            className="absolute left-[9%] right-[9%] top-[27px] hidden h-px opacity-50 md:block"
            style={{ background: "linear-gradient(90deg,var(--teal),var(--lp-border) 50%,var(--teal))" }}
          />
          <div className="relative grid grid-cols-1 gap-8 md:grid-cols-3">
            {steps.map((s) => (
              <div key={s.tag}>
                <div className="mb-5 flex h-[54px] w-[54px] items-center justify-center rounded-full border-2 border-[var(--teal)] text-[var(--teal)]">
                  <s.icon className="h-[22px] w-[22px]" strokeWidth={2} />
                </div>
                <p className="mb-2 text-xs tracking-wide text-[var(--teal)]" style={{ fontFamily: "'DM Mono',monospace" }}>
                  {s.tag}
                </p>
                <h3 className="mb-2 text-[17px] font-bold">{s.title}</h3>
                <p className="text-sm leading-relaxed text-[var(--lp-muted)]">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-7 flex items-center gap-3 rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-card)] px-[22px] py-[18px]">
          <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--teal)]" />
          <span className="flex-1 text-[13px]">Evento de lead qualificado enviado pra Meta, campanha "Leads — Setembro".</span>
          <span className="whitespace-nowrap text-xs text-[var(--lp-muted)]" style={{ fontFamily: "'DM Mono',monospace" }}>
            API de Conversões · agora
          </span>
        </div>
      </div>
    </Reveal>
  );
}

function Simulator() {
  return (
    <Reveal id="simulador" className="border-t border-[var(--lp-border)] px-6 py-16 md:py-24">
      <div className="mx-auto max-w-[1100px]">
        <div className="mx-auto mb-8 max-w-[700px] text-center">
          <div
            className="mb-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold text-[var(--teal)]"
            style={{ background: "var(--teal-dim)", fontFamily: "'DM Mono',monospace" }}
          >
            EXPERIMENTE
          </div>
          <h2 className="mb-3.5 text-[26px] font-extrabold tracking-[-0.02em] md:text-[38px]">Essa é a tela de verdade</h2>
          <p className="text-base leading-relaxed text-[var(--lp-muted)]">
            Pixel a pixel igual ao sistema, com dados de exemplo. Clique num cliente pra ver as campanhas dele, ou em
            Automações pra ver as mensagens configuradas.
          </p>
        </div>
        <AppSimulator />
      </div>
    </Reveal>
  );
}

function HowItWorks() {
  const steps = [
    { n: "01", title: "Conecte sua conta Meta", desc: "Login com Facebook, leva menos de 2 minutos. Sem precisar criar nenhum app." },
    { n: "02", title: "Importe seus clientes", desc: "O sistema busca suas contas de anúncio e já sugere página e WhatsApp preenchidos." },
    { n: "03", title: "Deixe rodar", desc: "Relatórios, vendas e saldo cuidam de si — você só entra pra decidir o que importa." },
  ];
  return (
    <Reveal id="como-funciona" className="border-t border-[var(--lp-border)] px-6 py-16 md:py-24">
      <div className="mx-auto max-w-[1000px]" style={{ background: "var(--lp-bg-deep)" }}>
        <h2 className="mb-14 text-center text-[26px] font-extrabold tracking-[-0.02em] md:text-[38px]">
          Do zero ao primeiro relatório automático
        </h2>
        <div className="grid grid-cols-1 gap-7 md:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n}>
              <p className="mb-3.5 text-[13px] text-[var(--teal)]" style={{ fontFamily: "'DM Mono',monospace" }}>{s.n}</p>
              <h3 className="mb-2.5 text-lg font-bold">{s.title}</h3>
              <p className="text-sm leading-relaxed text-[var(--lp-muted)]">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </Reveal>
  );
}

function Pricing() {
  return (
    <Reveal id="planos" className="border-t border-[var(--lp-border)] px-6 py-16 md:py-24">
      <div className="mx-auto max-w-[980px]">
        <div className="mb-12 text-center">
          <h2 className="mb-3.5 text-[26px] font-extrabold tracking-[-0.02em] md:text-[38px]">Planos simples, sem pegadinha</h2>
          <p className="text-base text-[var(--lp-muted)]">Mensal, sem fidelidade. Cancele quando quiser.</p>
        </div>
        <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
          <div className="rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-card)] p-[34px]">
            <p className="mb-1.5 text-[15px] font-bold text-[var(--lp-muted)]">Start</p>
            <div className="mb-1.5 flex items-baseline gap-1.5">
              <span className="text-4xl font-extrabold">R$ 129</span>
              <span className="text-sm text-[var(--lp-muted)]">/mês</span>
            </div>
            <p className="mb-[26px] text-[13px] text-[var(--lp-muted-2)]">Pra começar a centralizar sua operação.</p>
            <a
              href="#top"
              className="mb-7 flex w-full items-center justify-center rounded-[10px] border border-[var(--lp-border-strong)] py-3.5 text-[15px] font-bold transition-colors hover:border-[var(--teal)] hover:text-[var(--teal)]"
            >
              Quero o Start
            </a>
            <ul className="flex flex-col gap-3.5">
              {[
                ["Clientes e campanhas ilimitados", true],
                ["Importação automática do Facebook", true],
                ["Relatório semanal automático no WhatsApp", true],
                ["Rastreamento de vendas, CPL e saldo", true],
                ["Agente de IA nas campanhas", false],
                ["Resumo de grupo automático", false],
              ].map(([label, included]) => (
                <li key={label as string} className={`flex gap-2.5 text-sm ${included ? "" : "text-[var(--lp-muted-2)]"}`}>
                  <span className={included ? "text-[var(--teal)]" : "text-[var(--lp-muted-2)]"}>{included ? "✓" : "–"}</span>
                  {label}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative rounded-2xl border border-[var(--teal)] p-[34px] transition-transform duration-300 hover:-translate-y-1.5" style={{ background: "var(--lp-card-2)" }}>
            <div
              className="absolute left-1/2 top-[-13px] -translate-x-1/2 rounded-full px-3.5 py-1 text-xs font-extrabold text-[var(--teal-ink)]"
              style={{ background: "var(--teal)", fontFamily: "'DM Mono',monospace" }}
            >
              MAIS ESCOLHIDO
            </div>
            <p className="mb-1.5 text-[15px] font-bold text-[var(--teal)]">Plus</p>
            <div className="mb-1.5 flex items-baseline gap-1.5">
              <span className="text-4xl font-extrabold">R$ 197</span>
              <span className="text-sm text-[var(--lp-muted)]">/mês</span>
            </div>
            <p className="mb-[26px] text-[13px] text-[var(--lp-muted-2)]">Pra automatizar de ponta a ponta.</p>
            <a
              href="#top"
              className="mb-7 flex w-full items-center justify-center rounded-[10px] bg-[var(--teal)] py-3.5 text-[15px] font-bold text-[var(--teal-ink)] transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-6px_rgba(0,0,0,0.5)]"
            >
              Quero o Plus
            </a>
            <ul className="flex flex-col gap-3.5">
              {[
                "Tudo do Start",
                "Agente de IA: pausa, ajusta orçamento e analisa campanhas",
                "Resumo de grupo automático (manhã e tarde)",
                "Compartilhamento de clientes com agências parceiras",
                "Usuários ilimitados por organização",
                "Suporte prioritário",
              ].map((label) => (
                <li key={label} className="flex gap-2.5 text-sm">
                  <span className="text-[var(--teal)]">✓</span>
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Reveal>
  );
}

const FAQ_ITEMS = [
  {
    q: "Preciso trocar como eu já anuncio no Meta?",
    a: "Não. Você continua anunciando normalmente pelo Gerenciador de Anúncios da Meta — o sistema só centraliza a gestão, os relatórios e o rastreamento de vendas por cima do que já existe.",
  },
  {
    q: "Funciona pra qualquer nicho?",
    a: "Sim. Foi construído pensando no dia a dia de quem gerencia tráfego, gestor autônomo ou agência, e funciona pra qualquer cliente que anuncia no Meta, não importa o nicho.",
  },
  {
    q: "Preciso saber programar ou mexer em API da Meta?",
    a: "Não. É só conectar sua conta do Facebook pelo login. O sistema cuida de toda a parte técnica por trás.",
  },
  {
    q: "Dá pra ter mais de um gestor usando?",
    a: "Sim. Cada gestor entra com seu próprio login, com os clientes atribuídos a ele — e o admin da agência enxerga tudo.",
  },
];

function Faq() {
  return (
    <Reveal id="faq" className="border-t border-[var(--lp-border)] px-6 py-16 md:py-24">
      <div className="mx-auto max-w-[760px]" style={{ background: "var(--lp-bg-deep)" }}>
        <h2 className="mb-11 text-center text-[26px] font-extrabold tracking-[-0.02em] md:text-[38px]">
          Dúvidas antes de começar
        </h2>
        <div className="flex flex-col border-t border-[var(--lp-border)]">
          {FAQ_ITEMS.map((item) => (
            <details key={item.q} className="group border-b border-[var(--lp-border)] py-[22px] px-0.5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold [&::-webkit-details-marker]:hidden">
                {item.q}
                <Plus className="h-[22px] w-[22px] shrink-0 text-[var(--teal)] transition-transform duration-[250ms] group-open:rotate-45" />
              </summary>
              <p className="mt-3.5 max-w-[600px] text-sm leading-relaxed text-[var(--lp-muted)]">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </Reveal>
  );
}

function FinalCta() {
  return (
    <Reveal className="relative overflow-hidden border-t border-[var(--lp-border)] px-6 py-16 md:py-28">
      <div
        className="absolute bottom-[-220px] left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full opacity-[0.14] blur-[90px]"
        style={{ background: "var(--teal)" }}
        aria-hidden
      />
      <div className="relative mx-auto flex max-w-[640px] flex-col items-center gap-[22px] text-center">
        <h2 className="text-[28px] font-extrabold tracking-[-0.02em] md:text-[42px]">
          Pronto pra parar de perder venda no meio do caminho?
        </h2>
        <p className="text-base text-[var(--lp-muted)]">Comece hoje e já configure sua primeira automação em minutos.</p>
        <a
          href="#planos"
          className="inline-flex items-center justify-center rounded-[10px] bg-[var(--teal)] px-8 py-4 text-base font-bold text-[var(--teal-ink)] transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-6px_rgba(0,0,0,0.5)]"
        >
          Ver planos e preços
        </a>
      </div>
    </Reveal>
  );
}

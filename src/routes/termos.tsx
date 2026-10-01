import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/termos")({
  head: () => ({ meta: [{ title: "Termos de Uso — Gestor de Tráfego" }] }),
  component: TermsPage,
});

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold tracking-tight mt-8 mb-2">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground leading-relaxed mb-3">{children}</p>;
}
function Ul({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc list-outside pl-5 text-sm text-muted-foreground leading-relaxed space-y-1 mb-3">{children}</ul>;
}
function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="underline underline-offset-2 hover:text-foreground">
      {children}
    </a>
  );
}

function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Termos de Uso</h1>
        <p className="text-xs text-muted-foreground mb-8">Última atualização: [DATA]</p>

        <P>
          Estes Termos de Uso regem o acesso e uso do <strong className="text-foreground">Gestor de Tráfego</strong>,
          sistema interno da <strong className="text-foreground">[RAZÃO SOCIAL DA EMPRESA], CNPJ [NÚMERO]</strong> ("Triad
          Company", "nós"). Ao fazer login, você ("gestor" ou "usuário") concorda com estes termos.
        </P>

        <H2>1. O que é o sistema</H2>
        <P>
          O Gestor de Tráfego é uma ferramenta interna de gestão de tráfego pago: permite criar, duplicar e
          acompanhar campanhas de anúncio na Meta (Facebook/Instagram), rastrear leads recebidos via
          WhatsApp, automatizar mensagens e relatórios, e operar um funil de comentário → Direct no
          Instagram. Não é um produto vendido a terceiros nem disponibilizado ao público.
        </P>

        <H2>2. Quem pode usar</H2>
        <P>
          O acesso é restrito a gestores de tráfego autorizados pela agência (ou por organizações parceiras
          cadastradas no sistema), cada um com login individual. É proibido compartilhar credenciais de
          acesso com terceiros não autorizados.
        </P>

        <H2>3. Responsabilidades do usuário</H2>
        <Ul>
          <li>Usar o acesso à Meta concedido via login apenas para gerenciar contas de anúncio que você está autorizado a administrar;</li>
          <li>Não usar o sistema para enviar mensagens não solicitadas (spam) ou violar as Políticas de Publicidade e as Diretrizes da Comunidade da Meta;</li>
          <li>Manter a confidencialidade das próprias credenciais e relatar imediatamente qualquer uso indevido da sua conta;</li>
          <li>Garantir que tem permissão para atuar em nome dos clientes/contas de anúncio que conecta ao sistema.</li>
        </Ul>

        <H2>4. Dados e privacidade</H2>
        <P>
          O uso do sistema envolve o tratamento de dados pessoais e de terceiros, conforme descrito na nossa{" "}
          <A href="/privacidade">Política de Privacidade</A>.
        </P>

        <H2>5. Disponibilidade e suporte</H2>
        <P>
          Fazemos o possível pra manter o sistema disponível, mas não garantimos funcionamento ininterrupto.
          Manutenções, instabilidades de provedores externos (Meta, Evolution API, OpenAI) ou do servidor
          próprio podem causar indisponibilidade temporária.
        </P>

        <H2>6. Limitação de responsabilidade</H2>
        <P>
          O sistema é fornecido "como está". Não nos responsabilizamos por perdas decorrentes de decisões de
          investimento em anúncios tomadas com base nos dados exibidos, nem por instabilidades ou mudanças
          nas APIs de terceiros (Meta, WhatsApp/Evolution API, OpenAI) fora do nosso controle.
        </P>

        <H2>7. Encerramento de acesso</H2>
        <P>
          Podemos suspender ou encerrar o acesso de um usuário a qualquer momento, em especial em caso de uso
          indevido, violação destes termos ou desligamento da agência/organização.
        </P>

        <H2>8. Alterações nestes termos</H2>
        <P>Podemos atualizar estes termos conforme o sistema evolui. A data da última atualização sempre aparece no topo desta página.</P>

        <H2>9. Lei aplicável</H2>
        <P>Estes termos são regidos pelas leis da República Federativa do Brasil.</P>

        <H2>10. Contato</H2>
        <P>Dúvidas sobre estes termos: <A href="mailto:[EMAIL DE SUPORTE]">[EMAIL DE SUPORTE]</A>.</P>
      </div>
    </div>
  );
}

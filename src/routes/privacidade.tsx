import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacidade")({
  head: () => ({ meta: [{ title: "Política de Privacidade — Gestor de Tráfego" }] }),
  component: PrivacyPage,
});

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold tracking-tight mt-8 mb-2">{children}</h2>;
}
function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-4 mb-1.5">{children}</h3>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground leading-relaxed mb-3">{children}</p>;
}
function Ul({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc list-outside pl-5 text-sm text-muted-foreground leading-relaxed space-y-1 mb-3">{children}</ul>;
}
function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
      {children}
    </a>
  );
}

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Política de Privacidade</h1>
        <p className="text-xs text-muted-foreground mb-8">Última atualização: [DATA]</p>

        <P>
          Esta Política de Privacidade descreve como o <strong className="text-foreground">Gestor de Tráfego</strong> ("nós", "nosso"
          ou "sistema"), ferramenta interna da <strong className="text-foreground">[RAZÃO SOCIAL DA EMPRESA], CNPJ [NÚMERO]</strong> ("Triad
          Company"), coleta, usa e protege dados ao gerenciar campanhas de anúncios da Meta (Facebook e
          Instagram) e automações de atendimento via WhatsApp em nome das contas de clientes da agência.
        </P>

        <H2>1. Quem usa este sistema</H2>
        <P>
          O Gestor de Tráfego é uma ferramenta de uso <strong className="text-foreground">interno</strong>: só gestores de tráfego que
          trabalham na agência (ou em agências parceiras que também o utilizam) têm acesso, mediante login
          próprio. Ele não é um produto aberto ao público nem aos clientes finais dos anúncios.
        </P>

        <H2>2. Dados que coletamos</H2>
        <H3>2.1 Ao conectar uma conta da Meta (Login do Facebook)</H3>
        <Ul>
          <li>Nome e identificador público do perfil que fez login;</li>
          <li>Contas de anúncio, campanhas, conjuntos de anúncios, anúncios e métricas de desempenho (gasto, impressões, cliques, conversas iniciadas) das contas de anúncio que o gestor administra;</li>
          <li>Páginas do Facebook e contas comerciais do Instagram vinculadas às contas de anúncio gerenciadas.</li>
        </Ul>
        <H3>2.2 Ao conectar o Instagram (funil de comentário → Direct)</H3>
        <Ul>
          <li>Comentários públicos recebidos em publicações do Instagram da agência, e o texto das mensagens trocadas no Direct dentro do funil configurado;</li>
          <li>Identificador público (não o nome real, salvo quando a pessoa o informa na conversa) de quem comenta ou envia mensagem.</li>
        </Ul>
        <H3>2.3 Ao conectar um número de WhatsApp (via Evolution API, self-hosted)</H3>
        <Ul>
          <li>Mensagens trocadas nos grupos e conversas usados para rastrear leads e automatizar relatórios/respostas;</li>
          <li>Número de telefone de contatos e grupos conectados.</li>
        </Ul>

        <H2>3. Para que usamos esses dados</H2>
        <P>Usamos os dados exclusivamente para:</P>
        <Ul>
          <li>Exibir métricas e permitir a criação/edição/duplicação de campanhas de anúncio em nome do gestor autenticado;</li>
          <li>Atribuir leads recebidos no WhatsApp às campanhas de anúncio correspondentes;</li>
          <li>Disparar automações de mensagem configuradas pelo próprio gestor (relatórios periódicos, resumos, respostas automáticas de comentário/Direct no Instagram);</li>
          <li>Classificar a intenção de uma resposta dentro de um funil de Instagram configurado, usando IA (ver seção 4).</li>
        </Ul>
        <P>Não vendemos, alugamos nem usamos esses dados para publicidade de terceiros.</P>

        <H2>4. Compartilhamento com terceiros (subprocessadores)</H2>
        <Ul>
          <li><strong className="text-foreground">Meta Platforms, Inc.</strong> — fonte dos dados (Graph API / Marketing API), conforme a autorização dada pelo próprio gestor no login;</li>
          <li><strong className="text-foreground">Evolution API</strong> — gateway de WhatsApp próprio da agência (self-hosted), usado só pra enviar/receber as mensagens das automações configuradas;</li>
          <li><strong className="text-foreground">OpenAI</strong> — usada apenas quando o gestor liga explicitamente a opção "Classificar com IA" num bloco de condição do funil de Instagram, para interpretar a resposta de um lead e decidir qual caminho do funil seguir. Só o texto da mensagem é enviado, sem identificadores adicionais.</li>
        </Ul>
        <P>Nenhum desses terceiros usa os dados para fins próprios — só processam em nome da agência.</P>

        <H2>5. Armazenamento e segurança</H2>
        <P>
          Os dados são armazenados em um banco de dados Postgres operado pela própria agência, em servidor
          próprio. O acesso ao sistema exige login e senha individuais, e tokens de acesso à Meta são
          armazenados de forma restrita, acessíveis apenas pelo backend da aplicação.
        </P>

        <H2>6. Retenção e exclusão de dados</H2>
        <P>
          Mantemos os dados enquanto a conta/organização estiver ativa no sistema. Qualquer gestor pode
          solicitar a exclusão dos próprios dados, ou a desconexão de uma conta da Meta/Instagram/WhatsApp, a
          qualquer momento pelo próprio sistema (em Configurações) ou escrevendo para{" "}
          <A href="mailto:[EMAIL DE SUPORTE]">[EMAIL DE SUPORTE]</A>. Atendemos pedidos de exclusão em até 30
          dias.
        </P>
        <P>
          Se você usou "Entrar com Facebook" e quer que a Meta pare de compartilhar seus dados com este
          sistema, remova o acesso do app em{" "}
          <A href="https://www.facebook.com/settings?tab=business_tools">Configurações do Facebook → Aplicativos e sites</A>
          . Isso revoga o token imediatamente; os dados já sincronizados são apagados do nosso banco em até
          30 dias ou mediante solicitação direta pelo email acima.
        </P>

        <H2>7. Seus direitos (LGPD)</H2>
        <P>
          Como titular de dados, você pode solicitar a qualquer momento: confirmação de quais dados temos
          sobre você, correção de dados incompletos/incorretos, anonimização ou exclusão de dados
          desnecessários, e informação sobre com quem compartilhamos seus dados. Solicitações pelo email{" "}
          <A href="mailto:[EMAIL DE SUPORTE]">[EMAIL DE SUPORTE]</A>.
        </P>

        <H2>8. Alterações nesta política</H2>
        <P>Podemos atualizar esta política conforme o sistema evolui. A data da última atualização sempre aparece no topo desta página.</P>

        <H2>9. Contato</H2>
        <P>Dúvidas sobre esta política ou sobre seus dados: <A href="mailto:[EMAIL DE SUPORTE]">[EMAIL DE SUPORTE]</A>.</P>
      </div>
    </div>
  );
}

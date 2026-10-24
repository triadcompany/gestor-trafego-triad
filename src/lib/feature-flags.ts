// Organização do próprio dono do sistema (Thiago, login triadcompanyy@gmail.com)
// — usada pra escopar funcionalidades experimentais só pra ela antes de
// liberar pras demais organizações do SaaS (ver memória "Triad Company é a
// org do dono"). Tirar o gate (não a constante) quando a feature for
// liberada geral.
export const TRIAD_COMPANY_ORG_ID = "c8f7908d-df29-49a4-993b-10b2dbca8a67";

export function isTriadCompanyOrg(organizationId: string | null | undefined): boolean {
  return organizationId === TRIAD_COMPANY_ORG_ID;
}

# Design: Autenticação Real + Tarefas

**Data:** 2026-04-30  
**Status:** Aprovado

---

## Contexto

O sistema atualmente não tem autenticação real — o "login" é apenas o cadastro de um token Meta Ads. Qualquer pessoa com a URL acessa tudo. O objetivo é adicionar autenticação email+senha via Supabase Auth e, sobre essa base, construir um sistema de tarefas com atribuição de responsáveis.

---

## Fase 1 — Autenticação

### Objetivo

Proteger todas as rotas do sistema. Apenas usuários com conta ativa podem acessar.

### Login

- A página `/login` passa a usar Supabase Auth (`signInWithPassword`) com email e senha
- O token Meta Ads sai do fluxo de login e fica exclusivamente em `/settings` (já existente)
- Ao autenticar com sucesso, o usuário é redirecionado para `/`
- Sessão gerenciada automaticamente pelo cliente Supabase (refresh token incluso)

### Proteção de rotas

- A rota raiz (`__root.tsx`) recebe um `beforeLoad` que busca a sessão Supabase
- Se não houver sessão, lança `redirect({ to: "/login" })` via TanStack Router
- A rota `/login` fica isenta da verificação (sem `beforeLoad`)
- Logout disponível no `AppShell` — chama `supabase.auth.signOut()` e redireciona para `/login`

### Tabela `profiles`

Armazena o nome de exibição de cada usuário, vinculado ao `auth.users` do Supabase.

```sql
CREATE TABLE profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: todos leem, cada um atualiza só o próprio
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth.uid() = id);
```

Um trigger cria o registro em `profiles` automaticamente quando um usuário é adicionado:

```sql
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

### Gestão de usuários

Feita pelo Supabase Dashboard → Authentication → Users. O admin cria contas via "Invite user" (envia email com link de definição de senha). Não há página de gestão dentro do app.

Todos os usuários têm o mesmo nível de acesso.

---

## Fase 2 — Tarefas

### Objetivo

Substituir a ausência de tarefas reais na página `/tarefas`. Atualmente a página tem anotações e relatórios — as tarefas entram como uma terceira aba.

### UI

Nova aba **"Tarefas"** na página `/tarefas`, ao lado de "Anotações" e "Relatórios" (layout A). O badge de contagem na aba exibe tarefas pendentes + em andamento.

### Campos de uma tarefa

| Campo | Tipo | Obrigatório |
|---|---|---|
| `title` | texto | sim |
| `status` | enum | sim (default: pendente) |
| `due_date` | data | não |
| `client_id` | FK → clients | não |
| `assigned_to` | FK → profiles | não |
| `created_by` | FK → profiles | sim (auto) |
| `created_at` | timestamptz | sim (auto) |

**Status possíveis:** `pendente` · `em_andamento` · `concluida`

### Banco de dados

```sql
CREATE TABLE tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  status      text NOT NULL DEFAULT 'pendente'
                CHECK (status IN ('pendente', 'em_andamento', 'concluida')),
  due_date    date,
  client_id   uuid REFERENCES clients(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_by  uuid REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tasks_all" ON tasks FOR ALL USING (auth.uid() IS NOT NULL);
```

### Criação de tarefa

Dialog acionado por "+ Nova tarefa" no header da aba. Campos:
- Título (input, obrigatório)
- Status (select: Pendente / Em andamento / Concluída)
- Prazo (date picker, opcional)
- Cliente (select dos clientes ativos, opcional)
- Responsável (select dos profiles, opcional)

### Listagem

- Ordenação padrão: pendentes primeiro → em andamento → concluídas; dentro de cada grupo, por prazo mais próximo
- Prazo vencido exibido em vermelho
- Tarefas concluídas ficam com opacidade reduzida e título riscado
- Ações inline: mudar status, editar, excluir

### Filtros

- Por status (todos / pendente / em andamento / concluída)
- Por responsável (todos / pessoa específica)

---

## Ordem de implementação

1. Migration `profiles` + trigger no Supabase
2. Refatorar `/login` para Supabase Auth
3. Proteger rotas em `__root.tsx`
4. Adicionar logout no `AppShell`
5. Migration `tasks` no Supabase
6. Queries CRUD de tarefas em `queries.ts`
7. Nova aba "Tarefas" em `tarefas.tsx`
8. Dialog de criação/edição de tarefa
9. Filtros na aba de tarefas

---

## Dependências

- Supabase Auth habilitado (já está)
- SMTP configurado no Supabase para envio do invite (verificar)
- Migrations rodando antes do deploy

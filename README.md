# Copiloto Restaurante

[![CI](https://github.com/GabrielDenardi/copiloto-restaurante/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/GabrielDenardi/copiloto-restaurante/actions/workflows/ci.yml)

Copiloto de IA para donos de restaurante em plataformas de delivery. O dono pergunta em português ("por que as vendas caíram na terça?", "do que estão reclamando?", "monta uma promoção pro jantar de segunda") e o agente responde com números tirados dos dados, nunca inventados.

> **Status:** esqueleto. Já existem os dados sintéticos, o servidor MCP com as ferramentas e o eval do detector de anomalias rodando no CI. O agente, o chat e a observabilidade vêm a seguir (veja o [roadmap](#roadmap)).

## Como rodar

Requer Node 24.

```bash
npm install
npm run seed            # gera o banco em .pgdata/
npm test                # typecheck à parte: npm run typecheck
npm run eval:detector   # avalia o detector em 100 seeds
```

### Usar com o Claude Code

O repositório já traz um `.mcp.json`. Abra a pasta no Claude Code, aprove o servidor `copiloto-restaurante` e pergunte, por exemplo: *"o que está errado no restaurante nas últimas 4 semanas?"*.

### Inspecionar as ferramentas

```bash
npx @modelcontextprotocol/inspector node --import tsx packages/mcp-server/src/stdio.ts
```

## Estrutura

```
packages/
  data/        gerador de dados sintéticos determinístico + Postgres embutido (PGlite)
  mcp-server/  servidor MCP com as ferramentas do agente
  evals/       avaliações automáticas (por enquanto, do detector de anomalias)
```

## Dados sintéticos

A **Cantina Nonna Rosa** é um restaurante fictício com 90 dias de operação (28/07 a 25/10/2026): cerca de 7,9 mil pedidos, 16,6 mil itens e 2,3 mil avaliações em português, com sazonalidade de almoço e jantar, fim de semana mais forte e crescimento leve.

O gerador é determinístico (mesma seed, mesmos dados) e planta três problemas com gabarito conhecido. É isso que permite medir se o agente acerta:

| Padrão plantado | O que acontece | Pergunta que deveria responder |
| --- | --- | --- |
| Queda nas terças | Pedidos de terça caem 40% nas últimas 4 semanas | "Por que minhas vendas caíram na terça?" |
| Lasanha chegando fria | Nos últimos 30 dias, 55% das avaliações de pedidos com lasanha reclamam de comida fria | "Do que estão reclamando?" |
| Incidente na cozinha | Num sábado, o preparo atrasa 20 a 35 min e 25% dos pedidos são cancelados | "O que aconteceu no dia 17?" |

## Ferramentas MCP

| Ferramenta | O que faz | Escreve? |
| --- | --- | --- |
| `list_menu_items` | Cardápio com ids e preços, para o agente mapear "a lasanha" para um id | não |
| `get_sales_summary` | Pedidos, cancelamentos, receita e ticket médio, com quebra por dia, dia da semana, hora ou item e comparação com o período anterior | não |
| `analyze_reviews` | Nota média, distribuição, categorias de reclamação com exemplos e tendência semanal | não |
| `detect_anomalies` | Dias fora do padrão, dias da semana que mudaram e itens cuja nota caiu | não |
| `draft_campaign` | Salva uma campanha de desconto como **rascunho pendente de aprovação**, com o volume histórico daquele horário | só rascunho |

## Eval do detector de anomalias

O `detect_anomalies` roda contra 200 restaurantes gerados com seeds diferentes. Cada anomalia retornada é conferida contra o gabarito: ou ela explica um padrão plantado, ou conta como alarme falso.

| Padrão | Detectado |
| --- | --- |
| Queda nas terças | 200/200 |
| Lasanha chegando fria | 200/200 |
| Incidente na cozinha | 200/200 |
| **Alarmes falsos** | **1 em 200 execuções (0,5%)** |

O CI roda 50 seeds a cada push e reprova se algum padrão deixar de ser detectado ou se a taxa de alarmes falsos passar de 2%.

## Decisões

- **Postgres de verdade sem Docker.** O PGlite roda Postgres em WebAssembly dentro do processo Node. O SQL é o mesmo que vai para um Postgres gerenciado em produção, e cada arquivo de teste sobe o próprio banco em memória em poucos segundos.
- **Descrições das ferramentas em inglês, respostas em português.** As descrições entram no prompt a cada chamada, e português costuma gastar mais tokens que inglês. A diferença real de tokens, latência e qualidade vai ser medida no eval do agente.
- **JSON compacto nas respostas das ferramentas**, pelo mesmo motivo: o resultado do `detect_anomalies` com os três problemas cabe em ~1,8 mil caracteres.
- **Nada é publicado sem o dono.** `draft_campaign` é a única ferramenta que escreve, e só cria rascunho. As ferramentas declaram `readOnlyHint` para o cliente MCP saber o que é seguro chamar sem confirmação.
- **Detector com estatística, não só limiares.** A primeira versão acusava queda de nota em bruschetta, arancini e refrigerante só porque eles aparecem nos mesmos pedidos da lasanha. A versão atual:
  - pede z-score ≥ 3,5 para queda de nota (correção de Bonferroni para ~15 itens);
  - descarta os pedidos de um item já explicado antes de avaliar os outros;
  - usa teste de cauda de Poisson para cancelamentos, porque em dias de pouco movimento 4 cancelamentos em 40 pedidos não são sinal de nada.

## Roadmap

- [x] Dados sintéticos com padrões plantados
- [x] Servidor MCP com as ferramentas
- [x] Eval do detector rodando no CI
- [ ] Agente com caminho rápido para perguntas simples
- [ ] Chat em Next.js e resumo diário proativo
- [ ] Evals do agente: perguntas com gabarito, checagem de que todo número veio de uma ferramenta e simulador de dono em conversas longas
- [ ] Observabilidade: traces, custo por conversa e latência P95
- [ ] Dataset de avaliação em português publicado no Hugging Face

#!/usr/bin/env bash
# =============================================================================
# Chat AI Phase 0 接続テスト
# chat-ai-plan.md §10 「Phase 0 接続テスト Go/No-Go 基準」5 項目を自動化
#
# 注: 本スクリプトは bash + curl で OpenAI/Gemini REST API を直接叩きます。
# choices[0].message.content は OpenAI Chat Completions API の正規仕様
# フィールド (https://platform.openai.com/docs/api-reference/chat/object)。
# Vercel AI SDK の UIMessage 型 (message.parts) とは無関係です。
#
# 使い方:
#   1. 環境変数を export
#        export OPENAI_API_KEY="sk-..."
#        export GEMINI_API_KEY="AIza..."
#   2. 実行
#        bash scripts/chat-conn-test.sh
#   3. 結果を chat-ai-plan.md §3 §9 に反映
#
# 依存: bash, curl, jq (brew install jq)
# =============================================================================

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
info() { echo -e "${BLUE}[INFO]${NC} $1"; }

[ -z "$OPENAI_API_KEY" ] && { fail "OPENAI_API_KEY が未設定"; exit 1; }
[ -z "$GEMINI_API_KEY" ] && { fail "GEMINI_API_KEY が未設定"; exit 1; }
command -v jq >/dev/null || { fail "jq が未インストール (brew install jq)"; exit 1; }

# -----------------------------------------------------------------------------
# Test 0: API キーの形式バリデーション
# -----------------------------------------------------------------------------
info "=== Test 0: API キー形式 ==="
[[ "$OPENAI_API_KEY" =~ ^sk-[A-Za-z0-9_-]{20,}$ ]] && pass "OpenAI key 形式 OK" || fail "OpenAI key 形式不正"
[[ "$GEMINI_API_KEY" =~ ^AIza[A-Za-z0-9_-]{20,}$ ]] && pass "Gemini key 形式 OK" || fail "Gemini key 形式不正"

# -----------------------------------------------------------------------------
# Test 1: OpenAI gpt-5.4-nano が呼べるか + 価格確認 (models endpoint)
# -----------------------------------------------------------------------------
info "=== Test 1: OpenAI gpt-5.4-nano 接続 ==="
OPENAI_MODELS=$(curl -s -H "Authorization: Bearer $OPENAI_API_KEY" https://api.openai.com/v1/models)
if echo "$OPENAI_MODELS" | jq -e '.data[] | select(.id == "gpt-5.4-nano")' >/dev/null 2>&1; then
  pass "gpt-5.4-nano モデル ID 存在確認"
else
  warn "gpt-5.4-nano が models 一覧に無い (アクセス権 or モデル名問題)"
fi

OPENAI_RESP=$(curl -s https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.4-nano","messages":[{"role":"user","content":"Say OK"}],"max_completion_tokens":10,"temperature":0.1}')
if echo "$OPENAI_RESP" | jq -e '.choices[0].message.content' >/dev/null 2>&1; then
  CONTENT=$(echo "$OPENAI_RESP" | jq -r '.choices[0].message.content')
  pass "gpt-5.4-nano 推論成功: '$CONTENT'"
  USAGE=$(echo "$OPENAI_RESP" | jq -r '.usage | "input=\(.prompt_tokens) output=\(.completion_tokens)"')
  info "  usage: $USAGE"
else
  ERR=$(echo "$OPENAI_RESP" | jq -r '.error.message // "unknown"')
  fail "gpt-5.4-nano 推論失敗: $ERR"
fi

# -----------------------------------------------------------------------------
# Test 2: Gemini OpenAI 互換 endpoint の可否
# Gemini 2.5 系は reasoning tokens を消費するため max_completion_tokens は
# 200 程度の余裕を持って設定 (10 だと reasoning だけで使い切られて出力 0)
# -----------------------------------------------------------------------------
info "=== Test 2: Gemini 2.5 Flash OpenAI 互換 endpoint ==="
GEMINI_RESP=$(curl -s https://generativelanguage.googleapis.com/v1beta/openai/chat/completions \
  -H "Authorization: Bearer $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"Say OK in one word"}],"max_completion_tokens":200,"temperature":0.1}')
if echo "$GEMINI_RESP" | jq -e '.choices[0].message.content // ""' | grep -qv '^"$\|^null$'; then
  CONTENT=$(echo "$GEMINI_RESP" | jq -r '.choices[0].message.content // "(empty)"')
  pass "gemini-2.5-flash OpenAI 互換 endpoint OK: '$CONTENT'"
  GEMINI_COMPAT_OK=1
elif echo "$GEMINI_RESP" | jq -e '.choices' >/dev/null 2>&1; then
  # API は応答したが content が空 (reasoning token で予算消費)
  warn "API は応答したが content 空 — reasoning tokens 消費。Worker 側で max_tokens を 800+ に"
  GEMINI_COMPAT_OK=1   # API 動作は OK 扱い
else
  # error array 形式 ([{error:...}]) と object 形式 ({error:...}) 両対応
  ERR=$(echo "$GEMINI_RESP" | jq -r '(.error.message // .[0].error.message) // "unknown"' 2>/dev/null || echo "parse error")
  warn "OpenAI 互換 endpoint 失敗 ($ERR) — 独自 endpoint を試します"
  GEMINI_COMPAT_OK=0
fi

# -----------------------------------------------------------------------------
# Test 3: Gemini ネイティブ endpoint fallback
# -----------------------------------------------------------------------------
if [ "$GEMINI_COMPAT_OK" = "0" ]; then
  info "=== Test 3: Gemini ネイティブ endpoint fallback ==="
  GEMINI_NATIVE=$(curl -s "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$GEMINI_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"contents":[{"parts":[{"text":"Say OK"}]}],"generationConfig":{"maxOutputTokens":200}}')
  if echo "$GEMINI_NATIVE" | jq -e '.candidates[0].content.parts[0].text' >/dev/null 2>&1; then
    CONTENT=$(echo "$GEMINI_NATIVE" | jq -r '.candidates[0].content.parts[0].text')
    warn "OpenAI 互換は不可、ネイティブは OK ('$CONTENT')。Workers の PROVIDERS.gemini に独自 parser 必要"
  else
    fail "Gemini 2.5 Flash ネイティブも失敗 — モデル ID 要再確認"
  fi
fi

# -----------------------------------------------------------------------------
# Test 4: 日本語品質サンプル
# -----------------------------------------------------------------------------
info "=== Test 4: 日本語品質サンプル ==="
JA_PROMPT="切削加工で「逃げ面摩耗 VB」とは何か、初学者向けに 100 字以内で説明してください。"
JA_RESP=$(curl -s https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"gpt-5.4-nano\",\"messages\":[{\"role\":\"user\",\"content\":\"$JA_PROMPT\"}],\"max_completion_tokens\":400,\"temperature\":0.3}")
JA_CONTENT=$(echo "$JA_RESP" | jq -r '.choices[0].message.content // "(no response)"')
info "OpenAI gpt-5.4-nano 日本語応答:"
echo "  $JA_CONTENT"

# -----------------------------------------------------------------------------
# Test 5: SSE ストリーミング動作確認
# -----------------------------------------------------------------------------
info "=== Test 5: SSE ストリーミング ==="
SSE_RESP=$(curl -s -N https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.4-nano","messages":[{"role":"user","content":"Count 1 to 3"}],"max_completion_tokens":30,"temperature":0.1,"stream":true}' \
  | head -20)
if echo "$SSE_RESP" | grep -q "data:"; then
  SSE_LINES=$(echo "$SSE_RESP" | grep -c "^data:")
  pass "SSE フォーマット OK ($SSE_LINES 行受信)"
else
  fail "SSE フォーマット異常 — Workers 側の parseSSEChunk 要見直し"
fi

# -----------------------------------------------------------------------------
# Test 6: コスト試算用の使用量サマリ
# -----------------------------------------------------------------------------
info "=== Test 6: 想定コスト試算 (Anonymous 50 req/day, 100 ユーザー) ==="
echo "  gpt-5.4-nano 単価: input \$0.20/1M, output \$1.25/1M"
echo "  1 req: input 2k + output 500 ≒ \$0.00103"
echo "  50 req/day × 30 日 × 100 user = 150,000 req → \$154/月"
echo ""
echo "  Gemini 3 Flash 単価: 未確定 (preview 期間)"
echo "  → owner 側で Google AI Studio Console で実価格確認推奨"

echo ""
info "=== 完了 ==="
echo "次ステップ:"
echo "  1. PASS/FAIL を chat-ai-plan.md §10 Phase 0 Go/No-Go 基準に転記"
echo "  2. 価格情報を §9 コスト試算の Gemini 行に反映"
echo "  3. Cloudflare Workers env に OPENAI_API_KEY / GEMINI_API_KEY を設定"
echo "  4. KV Namespace 'INVITE_KV' を作成して bind"
echo "  5. ChatWidget の ⚙ で proxy URL を入力 → 動作確認"

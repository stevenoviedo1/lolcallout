# Local AI (Ollama) — LOLCallout

All AI coaching (live callouts, chat, post-game summaries) runs on the **player's own PC**
through [Ollama](https://ollama.com). There is no paid AI API and no AI key on the server.
Game data is never sent to an AI provider.

```
League Live Client :2999 → apps/agent (127.0.0.1:3847) → Ollama (127.0.0.1:11434/v1)
                                    ↑ /ai/status /ai/callout /ai/chat /ai/summary
                           apps/desktop (Electron)
```

* Model: `lolcoach` (custom, see below), falling back to `qwen2.5:3b-instruct`.
* Config (agent env): `OLLAMA_URL`, `LOLCOACH_MODEL`, `LOLCOACH_FALLBACK_MODEL`, `LOLCOACH_KEEP_ALIVE` (default `5m`).
* Prompt: `COACH_SYSTEM_PROMPT_SMALL` in `packages/prompts` (short; keeps every Riot policy rule).
  Payloads come from the same `buildUserPayload` as before; per-intent `max_tokens`/`temperature` are unchanged.
* If Ollama isn't running or no model is installed, the app uses the built-in coach lines
  (no AI) and shows a setup hint. Setup Wizard → **Local AI** checks everything.
* Screenshots/vision are disabled in local mode (text-only model).
* Load control: the agent runs **one generation at a time** (callouts get `429` while busy and the
  desktop speaks its seed line), callouts time out after 8 s, and the desktop waits ≥ 8 s between AI callouts.

## Player setup (Windows)

1. Install Ollama: https://ollama.com/download → run the installer. It starts in the tray.
2. Open PowerShell and pull the model (one time, ~2 GB):
   ```powershell
   ollama pull qwen2.5:3b-instruct
   ```
3. Optional — create the tuned coach model (from the LOLCallout install/repo folder):
   ```powershell
   ollama create lolcoach -f models/lolcoach/Modelfile
   ```
4. Open LOLCallout → Setup → **Local AI** → *Check again*. You should see ✅ for agent, Ollama, and model.

Hardware: **6 GB+ VRAM recommended**. A 3B Q4 model uses ≈2.5 GB VRAM; on integrated graphics or CPU
it works but is slow and can cost FPS — the built-in lines are fine in that case.
The model unloads after 5 minutes idle (`keep_alive`).

## Owner: collecting training data (opt-in, off by default)

Start the agent with pair logging on (never enabled for players by default):

```bash
npm run dev:agent:log-pairs            # or LOLCALLOUT_LOG_PAIRS=1 / agent flag --log-pairs
npm run pairs -- stats                 # count pairs per intent
npm run pairs -- export lolcoach-sft.jsonl
```

Pairs are written locally to `~/.lolcallout/training/pairs.jsonl` (`LOLCALLOUT_PAIRS_FILE` to change).
Each line has `system`, `history`, `user` (the exact payload), `response`, `intent`, `model`.
**Review and hand-fix responses** before training — the goal is to teach the small model the
voice and the Riot rules (options, not orders; no hidden-info guesses).

## Owner: synthetic training data (no games needed)

```bash
npm run training:data        # builds shared + prompts, then node scripts/make-training-data.mjs
```

Writes `training/lolcoach_train.jsonl` (95%) and `training/lolcoach_eval.jsonl` (5%) plus
`training/stats.json`. ~3000 live callouts, ~300 post-game summaries, ~300 champ-select plans across
~170 champions, in chat format (`system` = `LOLCOACH_SYSTEM_PROMPT_TINY`, `user` = compact payload
from `buildCompactUserPayload`, `assistant` = target). Every callout target passes
`checkLivePolicy` (packages/shared/src/policy.ts); rows stay under ~800 tokens, so
`max_seq_length=1024` fits an 8GB GPU (RTX 5060) with QLoRA, batch 2, grad-accum 8.

Serve the fine-tune with the same compact format: create it as `lolcoach-ft`
(`LOLCOACH_MODEL=lolcoach-ft`) or set `LOLCALLOUT_COMPACT_PAYLOAD=1`; the agent then sends the tiny
system prompt + SITUATION SUMMARY it was trained on. Base models keep the long payload.

Game knowledge comes from Data Dragon: `npm run ddragon` refreshes
`packages/shared/data/{champions,items}.json` after a patch (commit the result).

## Owner: fine-tuning lolcoach (QLoRA with Unsloth)

1. Get a GPU box (a free Colab T4 works for 3B) and install Unsloth:
   `pip install unsloth`
2. Train a QLoRA adapter on Qwen2.5-3B-Instruct:
   ```python
   from unsloth import FastLanguageModel
   from unsloth.chat_templates import get_chat_template
   from datasets import load_dataset
   from trl import SFTTrainer, SFTConfig

   model, tok = FastLanguageModel.from_pretrained(
       "unsloth/Qwen2.5-3B-Instruct", max_seq_length=4096, load_in_4bit=True)
   model = FastLanguageModel.get_peft_model(
       model, r=16, lora_alpha=16, lora_dropout=0,
       target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"])
   tok = get_chat_template(tok, chat_template="qwen-2.5")
   ds = load_dataset("json", data_files="lolcoach-sft.jsonl")["train"]
   ds = ds.map(lambda b: {"text": [tok.apply_chat_template(m, tokenize=False) for m in b["messages"]]},
               batched=True)
   SFTTrainer(model=model, tokenizer=tok, train_dataset=ds,
              args=SFTConfig(dataset_text_field="text", per_device_train_batch_size=2,
                             gradient_accumulation_steps=4, num_train_epochs=2,
                             learning_rate=2e-4, output_dir="out")).train()
   ```
   Start with a few hundred to a few thousand reviewed examples; keep a held-out set and listen to the output in real games.
3. Export GGUF Q4_K_M:
   ```python
   model.save_pretrained_gguf("lolcoach-gguf", tok, quantization_method="q4_k_m")
   ```
4. Create the Ollama model from the GGUF (same short system prompt + params):
   ```bash
   node scripts/gen-modelfile.mjs --base ./lolcoach-gguf/unsloth.Q4_K_M.gguf
   ollama create lolcoach -f models/lolcoach/Modelfile
   ```
   Players who have `lolcoach` installed get it automatically; everyone else keeps `qwen2.5:3b-instruct`.
   Distribute the GGUF (e.g. on Hugging Face / `ollama push`) and update the setup commands.

If you edit `COACH_SYSTEM_PROMPT_SMALL`, run `npm run gen:modelfile` so the Modelfile stays in sync.

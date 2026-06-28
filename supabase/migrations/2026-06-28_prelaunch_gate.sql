-- Pre-launch entry gate: the toll to submit a project draft (SOL fee + 1,000,000
-- $LOOP to the platform), verified on-chain. These columns store the payment sigs
-- and replay-guard them (each sig usable once). Idempotent.
alter table public.launch_waitlist add column if not exists gate_fee_sig text;
alter table public.launch_waitlist add column if not exists gate_loop_sig text;
create unique index if not exists launch_waitlist_gate_fee_sig_key
  on public.launch_waitlist (gate_fee_sig) where gate_fee_sig is not null;
create unique index if not exists launch_waitlist_gate_loop_sig_key
  on public.launch_waitlist (gate_loop_sig) where gate_loop_sig is not null;

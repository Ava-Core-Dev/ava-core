import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { KeyRound, Copy, Check } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { USE_MOCK, DEMO_LINK } from "../lib/rootmc-api";

const LIVE_LINK = !USE_MOCK && !DEMO_LINK;

export default function Auth() {
  const nav = useNavigate();
  const { login } = useAuth();
  const [step, setStep] = useState(LIVE_LINK ? 2 : 1);
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [issuedCode, setIssuedCode] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const startLink = async (e) => {
    e.preventDefault();
    if (username.trim().length < 3) return toast.error("Enter your Minecraft username (3-16 chars).");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/link/start", { minecraft_username: username.trim() });
      setIssuedCode(data.code);
      setCode(data.code); // pre-fill for demo mode
      setStep(2);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to start /link.");
    } finally {
      setLoading(false);
    }
  };

  const complete = async () => {
    if (code.trim().length !== 6) return toast.error("6-character code required.");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/link/complete", { code: code.trim().toUpperCase() });
      login(data.token, data.user);
      toast.success(`Linked as ${data.user.minecraft_username}`);
      nav("/rootmc", { replace: true });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Invalid or expired code.");
    } finally {
      setLoading(false);
    }
  };

  const copyCode = () => {
    if (!issuedCode) return;
    navigator.clipboard.writeText(issuedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="px-4 md:px-6 pt-6 pb-8 space-y-6 max-w-lg mx-auto"
      data-testid="auth-screen"
    >
      <div className="text-center space-y-2">
        <div className="mx-auto h-14 w-14 rounded-md bg-gold/10 border border-gold/30 grid place-items-center">
          <KeyRound className="text-gold" />
        </div>
        <h1 className="font-display font-extrabold text-2xl tracking-tight">Link your account</h1>
        <p className="text-sm text-text-secondary max-w-xs mx-auto">
          Prove you own your Minecraft account by running <span className="font-mono text-white">/link</span> in-game on <span className="font-mono text-white">play.rootmc.net</span>.
        </p>
      </div>

      {step === 1 && !LIVE_LINK ? (
        <form onSubmit={startLink} className="space-y-4">
          <div>
            <label className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-secondary mb-1.5 block">
              Minecraft username
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              data-testid="auth-username-input"
              placeholder="Notch"
              maxLength={16}
              className="w-full bg-black border border-white/20 rounded-md px-4 py-3 font-mono text-white focus:border-gold/50 focus:outline-none"
            />
          </div>
          <motion.button
            whileTap={{ scale: 0.97 }}
            disabled={loading}
            data-testid="auth-request-code-btn"
            className="w-full rounded-md bg-gold hover:bg-[#E6A600] text-black font-bold py-3.5"
          >
            {loading ? "Requesting…" : "Request code"}
          </motion.button>
        </form>
      ) : (
        <div className="space-y-4">
          {LIVE_LINK && (
            <div className="rounded-md border border-white/10 bg-bg-surface p-4 text-xs text-text-secondary leading-relaxed">
              Run <span className="font-mono text-white">/link</span> in-game on{" "}
              <span className="font-mono text-white">play.rootmc.net</span>, then paste the 6-character code below.
            </div>
          )}
          {issuedCode && (
            <div className="rounded-md border border-gold/30 bg-gold/5 p-4">
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-gold mb-1">
                Demo code (dev mode)
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="flex-1 font-mono text-2xl tracking-[0.4em] text-white bg-black rounded-md px-4 py-3 border border-white/10 text-center"
                  data-testid="auth-issued-code"
                >
                  {issuedCode}
                </div>
                <button
                  onClick={copyCode}
                  data-testid="auth-copy-code-btn"
                  className="h-12 w-12 rounded-md bg-white/10 hover:bg-white/20 grid place-items-center"
                >
                  {copied ? <Check size={16} className="text-pos" /> : <Copy size={16} />}
                </button>
              </div>
              <p className="text-xs text-text-secondary mt-2 leading-relaxed">
                In production, you&apos;d run <span className="font-mono text-white">/link</span> in-game to get this code. For demo, we&apos;ve pre-filled it.
              </p>
            </div>
          )}

          <div>
            <label className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-secondary mb-1.5 block">
              Enter 6-char code
            </label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
              data-testid="auth-code-input"
              placeholder="ABC123"
              className="w-full bg-black border border-white/20 rounded-md px-4 py-3 font-mono text-2xl tracking-[0.4em] text-center text-white focus:border-gold/50 focus:outline-none"
            />
          </div>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={complete}
            disabled={loading || code.length !== 6}
            data-testid="auth-complete-btn"
            className="w-full rounded-md bg-gold hover:bg-[#E6A600] disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold py-3.5"
          >
            {loading ? "Linking…" : "Complete link"}
          </motion.button>
          <button
            onClick={() => { setStep(1); setIssuedCode(null); setCode(""); }}
            className="w-full text-xs font-mono uppercase tracking-widest text-text-secondary hover:text-white"
            data-testid="auth-back-btn"
          >
            ← Start over
          </button>
        </div>
      )}
    </motion.div>
  );
}

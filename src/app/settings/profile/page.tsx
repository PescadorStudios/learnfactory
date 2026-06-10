"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, Camera, ImageIcon, Check, ArrowLeft } from "lucide-react";
import { useRequireAuth } from "@/lib/useAuth";
import { getMyProfile, updateProfile, uploadProfileImage } from "@/app/socialActions";

function ProfileSettings() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const onboarding = searchParams.get("onboarding") === "1";
  const { token, loading, session } = useRequireAuth();

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState<"avatar" | "banner" | null>(null);

  const avatarRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) return;
    getMyProfile(token).then(p => {
      if (p) {
        setUsername(p.username || "");
        setDisplayName(p.displayName || "");
        setBio(p.bio || "");
        setAvatarUrl(p.avatarUrl);
        setBannerUrl(p.bannerUrl);
      }
      setLoaded(true);
    });
  }, [token]);

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    setError("");
    setSaved(false);
    const res = await updateProfile(token, { username, displayName, bio });
    setSaving(false);
    if (!res.ok) {
      setError(res.error || "No se pudo guardar.");
      return;
    }
    setSaved(true);
    if (onboarding) {
      router.push("/");
    }
  };

  const handleImage = async (kind: "avatar" | "banner", e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    setUploading(kind);
    const reader = new FileReader();
    reader.onload = async () => {
      const res = await uploadProfileImage(token, kind, String(reader.result));
      setUploading(null);
      if (res.ok && res.url) {
        if (kind === "avatar") setAvatarUrl(res.url);
        else setBannerUrl(res.url);
      } else {
        setError(res.error || "No se pudo subir la imagen.");
      }
    };
    reader.readAsDataURL(file);
  };

  if (loading || !session || !loaded) {
    return <div className="min-h-screen bg-zinc-950 flex items-center justify-center"><Loader2 className="w-10 h-10 text-primary animate-spin" /></div>;
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <button onClick={() => router.push("/")} className="flex items-center gap-2 text-zinc-500 hover:text-white mb-6 text-sm">
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>

        <h1 className="text-3xl font-bold mb-1">{onboarding ? "Completa tu perfil" : "Editar perfil"}</h1>
        <p className="text-zinc-500 mb-8">{onboarding ? "Elige un nombre de usuario para empezar." : "Tu perfil público en LearnFactory."}</p>

        {/* Banner + avatar */}
        <div className="relative mb-16">
          <button
            onClick={() => bannerRef.current?.click()}
            className="block w-full h-40 rounded-2xl overflow-hidden bg-gradient-to-br from-primary/30 to-secondary/30 border border-zinc-800 relative group"
          >
            {bannerUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={bannerUrl} alt="banner" className="w-full h-full object-cover" />
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              {uploading === "banner" ? <Loader2 className="w-6 h-6 animate-spin" /> : <span className="flex items-center gap-2 text-sm"><ImageIcon className="w-4 h-4" /> Cambiar portada</span>}
            </div>
          </button>
          <input ref={bannerRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => handleImage("banner", e)} />

          <button
            onClick={() => avatarRef.current?.click()}
            className="absolute -bottom-12 left-6 w-24 h-24 rounded-full overflow-hidden bg-zinc-800 border-4 border-zinc-950 group"
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-zinc-500">
                {(displayName || username || "?")[0]?.toUpperCase()}
              </div>
            )}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              {uploading === "avatar" ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
            </div>
          </button>
          <input ref={avatarRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => handleImage("avatar", e)} />
        </div>

        <div className="space-y-5">
          <div>
            <label className="text-xs uppercase tracking-wider text-zinc-500 font-bold">Nombre de usuario</label>
            <div className="relative mt-1">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500">@</span>
              <input
                value={username}
                onChange={e => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())}
                maxLength={20}
                placeholder="tu_usuario"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-3 pl-9 pr-4 text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-zinc-500 font-bold">Nombre visible</label>
            <input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              maxLength={60}
              placeholder="Tu nombre"
              className="w-full mt-1 bg-zinc-900 border border-zinc-800 rounded-2xl py-3 px-4 text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-zinc-500 font-bold">Bio</label>
            <textarea
              value={bio}
              onChange={e => setBio(e.target.value)}
              maxLength={280}
              rows={3}
              placeholder="Cuéntale a la comunidad qué te apasiona enseñar..."
              className="w-full mt-1 bg-zinc-900 border border-zinc-800 rounded-2xl py-3 px-4 text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary resize-none"
            />
            <p className="text-right text-xs text-zinc-600">{bio.length}/280</p>
          </div>

          {error && <p className="text-rose-400 text-sm">{error}</p>}

          <motion.button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-4 bg-primary hover:bg-primary-hover text-white font-bold rounded-2xl flex items-center justify-center gap-2 transition-all disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : saved ? <Check className="w-5 h-5" /> : null}
            {onboarding ? "Continuar" : saved ? "Guardado" : "Guardar cambios"}
          </motion.button>
        </div>
      </div>
    </main>
  );
}

export default function ProfileSettingsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950" />}>
      <ProfileSettings />
    </Suspense>
  );
}

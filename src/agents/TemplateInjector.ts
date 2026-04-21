export const COMPONENT_LIBRARY: Record<string, string> = {
  hero_3d: `"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function Hero3D() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    const container = mountRef.current;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Particle system - 2000 particles
    const particleCount = 2000;
    const particleGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
      const isViolet = Math.random() > 0.5;
      colors[i * 3] = isViolet ? 0.39 : 0.02;
      colors[i * 3 + 1] = isViolet ? 0.4 : 0.71;
      colors[i * 3 + 2] = isViolet ? 0.95 : 0.83;
    }

    particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    particleGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const particleMaterial = new THREE.PointsMaterial({
      size: 0.03,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    // 8 floating geometric shapes
    const shapes: THREE.Mesh[] = [];
    const shapeMaterials = [
      new THREE.MeshStandardMaterial({ color: 0x6366f1, wireframe: true, transparent: true, opacity: 0.6 }),
      new THREE.MeshStandardMaterial({ color: 0x06b6d4, wireframe: true, transparent: true, opacity: 0.6 }),
    ];

    for (let i = 0; i < 8; i++) {
      const geo = i % 2 === 0
        ? new THREE.IcosahedronGeometry(0.4 + Math.random() * 0.3, 1)
        : new THREE.OctahedronGeometry(0.3 + Math.random() * 0.3, 0);
      const mesh = new THREE.Mesh(geo, shapeMaterials[i % 2]);
      mesh.position.set(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 4
      );
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      scene.add(mesh);
      shapes.push(mesh);
    }

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 2);
    scene.add(ambientLight);
    const pointLight1 = new THREE.PointLight(0x6366f1, 3, 50);
    pointLight1.position.set(5, 5, 5);
    scene.add(pointLight1);
    const pointLight2 = new THREE.PointLight(0x06b6d4, 3, 50);
    pointLight2.position.set(-5, -5, 5);
    scene.add(pointLight2);

    // Mouse parallax
    const mouse = { x: 0, y: 0 };
    const handleMouseMove = (e: MouseEvent) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener("mousemove", handleMouseMove);

    // Resize handler
    const handleResize = () => {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", handleResize);

    // Animation loop
    let animationId: number;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      particles.rotation.y += 0.0005;
      particles.rotation.x += 0.0002;
      shapes.forEach((shape, i) => {
        shape.rotation.x += 0.003 + i * 0.001;
        shape.rotation.y += 0.002 + i * 0.001;
        shape.position.y += Math.sin(Date.now() * 0.001 + i) * 0.002;
      });
      camera.position.x += (mouse.x * 0.5 - camera.position.x) * 0.05;
      camera.position.y += (mouse.y * 0.3 - camera.position.y) * 0.05;
      camera.lookAt(scene.position);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} className="absolute inset-0 -z-10" />;
}`,

  animated_navbar: `"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";

const navLinks = [
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#about", label: "About" },
  { href: "#contact", label: "Contact" },
];

export default function AnimatedNavbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.nav
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className={\`fixed top-0 left-0 right-0 z-50 transition-all duration-300 \${
        scrolled
          ? "bg-black/60 backdrop-blur-xl border-b border-white/10 shadow-lg"
          : "bg-transparent"
      }\`}
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/">
          <span className="text-xl font-bold bg-gradient-to-r from-violet-500 to-cyan-400 bg-clip-text text-transparent">
            ZOZO
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link, i) => (
            <motion.div
              key={link.href}
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 * i, duration: 0.4 }}
            >
              <Link
                href={link.href}
                className="text-sm text-gray-300 hover:text-white transition-colors"
              >
                {link.label}
              </Link>
            </motion.div>
          ))}
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="px-4 py-2 bg-gradient-to-r from-violet-600 to-cyan-500 rounded-lg text-sm font-medium text-white"
          >
            Get Started
          </motion.button>
        </div>

        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden text-white p-2"
        >
          <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
            {mobileOpen ? (
              <path d="M6 6l12 12M6 18L18 6" />
            ) : (
              <path d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-black/90 backdrop-blur-xl border-b border-white/10"
          >
            <div className="px-6 py-4 flex flex-col gap-4">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="text-gray-300 hover:text-white transition-colors"
                >
                  {link.label}
                </Link>
              ))}
              <button className="w-full px-4 py-2 bg-gradient-to-r from-violet-600 to-cyan-500 rounded-lg text-sm font-medium text-white">
                Get Started
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}`,

  stats_counter: `"use client";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

interface Stat {
  label: string;
  value: number;
  suffix: string;
}

const stats: Stat[] = [
  { label: "Developers", value: 10000, suffix: "+" },
  { label: "Apps Built", value: 50000, suffix: "+" },
  { label: "Uptime", value: 99, suffix: "%" },
  { label: "Build Time", value: 4, suffix: "s" },
];

function useInView(ref: React.RefObject<HTMLElement | null>) {
  const [isInView, setIsInView] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setIsInView(true); },
      { threshold: 0.3 }
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return isInView;
}

function AnimatedNumber({ value, suffix, inView }: { value: number; suffix: string; inView: boolean }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const duration = 2000;
    const step = (timestamp: number) => {
      if (!start) start = timestamp;
      const progress = Math.min((timestamp - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * value));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [value, inView]);
  return (
    <span className="text-4xl font-bold bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
      {count.toLocaleString()}{suffix}
    </span>
  );
}

export default function StatsCounter() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  return (
    <div ref={ref} className="grid grid-cols-2 md:grid-cols-4 gap-6 w-full max-w-5xl mx-auto">
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1, duration: 0.5 }}
          viewport={{ once: true }}
          className="p-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 text-center"
        >
          <AnimatedNumber value={stat.value} suffix={stat.suffix} inView={inView} />
          <p className="mt-2 text-sm text-gray-400">{stat.label}</p>
        </motion.div>
      ))}
    </div>
  );
}`,

  glassmorphism_card: `"use client";
import { motion } from "framer-motion";

interface GlassmorphismCardProps {
  title: string;
  description: string;
  icon: string;
  index: number;
}

export default function GlassmorphismCard({ title, description, icon, index }: GlassmorphismCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1, duration: 0.5 }}
      viewport={{ once: true }}
      whileHover={{ y: -8 }}
      className="group relative p-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 overflow-hidden cursor-pointer"
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-violet-500/10 rounded-full blur-3xl group-hover:bg-violet-500/20 transition-all duration-500" />
      <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
           style={{ background: "radial-gradient(600px circle at var(--mouse-x, 50%) var(--mouse-y, 50%), rgba(99, 102, 241, 0.1), transparent 40%)" }} />
      <div className="relative z-10">
        <span className="text-3xl mb-4 block">{icon}</span>
        <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
        <p className="text-sm text-gray-400 leading-relaxed">{description}</p>
      </div>
    </motion.div>
  );
}`,

  wallet_connect: `"use client";
import { useState } from "react";
import { motion } from "framer-motion";

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

function shortenAddress(addr: string): string {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

export default function WalletConnect() {
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connectWallet() {
    if (!window.ethereum) {
      setError("MetaMask not found. Please install MetaMask.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      if (accounts.length > 0) {
        setAddress(accounts[0]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {error && (
        <p className="text-red-400 text-sm bg-red-500/10 px-4 py-2 rounded-lg">{error}</p>
      )}
      {address ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="px-5 py-2.5 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 text-white font-mono text-sm"
        >
          {shortenAddress(address)}
        </motion.div>
      ) : (
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={connectWallet}
          disabled={loading}
          className="px-6 py-3 bg-gradient-to-r from-violet-600 to-cyan-500 rounded-xl text-white font-medium disabled:opacity-50 flex items-center gap-2"
        >
          {loading ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Connecting...
            </>
          ) : (
            "Connect Wallet"
          )}
        </motion.button>
      )}
    </div>
  );
}`,

  feature_grid: `"use client";
import { motion } from "framer-motion";

interface Feature {
  icon: string;
  title: string;
  description: string;
}

interface FeatureGridProps {
  features: Feature[];
}

export default function FeatureGrid({ features }: FeatureGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-6xl mx-auto">
      {features.map((feature, i) => (
        <motion.div
          key={feature.title}
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.08, duration: 0.5 }}
          viewport={{ once: true }}
          className="group relative p-6 rounded-2xl bg-white/5 border border-white/10 hover:border-violet-500/50 transition-all duration-300"
        >
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500/5 to-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <div className="relative z-10">
            <span className="text-3xl mb-4 block">{feature.icon}</span>
            <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
            <p className="text-sm text-gray-400 leading-relaxed">{feature.description}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}`,

  pricing_card: `"use client";
import { motion } from "framer-motion";

interface PricingCardProps {
  plan: string;
  price: string;
  period: string;
  features: string[];
  popular?: boolean;
}

export default function PricingCard({ plan, price, period, features, popular }: PricingCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileHover={{ scale: 1.03 }}
      className={\`relative p-8 rounded-2xl border transition-all duration-300 \${
        popular
          ? "bg-gradient-to-b from-violet-500/10 to-cyan-500/5 border-violet-500/50 shadow-[0_0_40px_rgba(99,102,241,0.15)]"
          : "bg-white/5 border-white/10 hover:border-white/20"
      }\`}
    >
      {popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-violet-600 to-cyan-500 rounded-full text-xs font-semibold text-white shadow-[0_0_20px_rgba(99,102,241,0.3)]">
          Most Popular
        </div>
      )}
      <h3 className="text-lg font-semibold text-white">{plan}</h3>
      <div className="mt-4 mb-6">
        <span className="text-4xl font-bold bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
          {price}
        </span>
        <span className="text-gray-500 text-sm ml-1">/{period}</span>
      </div>
      <ul className="space-y-3 mb-8">
        {features.map((f) => (
          <li key={f} className="flex items-center gap-2 text-sm text-gray-300">
            <svg className="w-4 h-4 text-violet-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {f}
          </li>
        ))}
      </ul>
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className={\`w-full py-3 rounded-xl text-sm font-medium transition-all \${
          popular
            ? "bg-gradient-to-r from-violet-600 to-cyan-500 text-white"
            : "bg-white/10 text-white hover:bg-white/15"
        }\`}
      >
        Get Started
      </motion.button>
    </motion.div>
  );
}`,

  chat_interface: `"use client";
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Message {
  id: string;
  role: "user" | "ai";
  content: string;
}

interface ChatInterfaceProps {
  messages: Message[];
  onSend: (message: string) => void;
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-2 h-2 bg-violet-400 rounded-full"
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </div>
  );
}

export default function ChatInterface({ messages, onSend }: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    onSend(input.trim());
    setInput("");
    setIsTyping(true);
    setTimeout(() => setIsTyping(false), 2000);
  }

  return (
    <div className="flex flex-col h-full rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 overflow-hidden">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={\`flex \${msg.role === "user" ? "justify-end" : "justify-start"}\`}
            >
              <div
                className={\`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed \${
                  msg.role === "user"
                    ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white rounded-br-sm"
                    : "bg-white/10 text-gray-200 rounded-bl-sm"
                }\`}
              >
                {msg.content}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {isTyping && <TypingIndicator />}
      </div>
      <form onSubmit={handleSubmit} className="p-4 border-t border-white/10 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:border-violet-500/50 text-sm"
        />
        <motion.button
          type="submit"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="px-4 py-2.5 bg-gradient-to-r from-violet-600 to-cyan-500 rounded-xl text-white text-sm font-medium"
        >
          Send
        </motion.button>
      </form>
    </div>
  );
}`,
};

const TEMPLATE_COMPONENTS: Record<string, string[]> = {
  web3: ["hero_3d", "animated_navbar", "wallet_connect", "glassmorphism_card", "stats_counter", "feature_grid"],
  "3d-landing": ["hero_3d", "animated_navbar", "glassmorphism_card", "stats_counter", "feature_grid"],
  saas: ["animated_navbar", "glassmorphism_card", "stats_counter", "feature_grid", "pricing_card"],
  "ai-tool": ["animated_navbar", "glassmorphism_card", "chat_interface", "stats_counter"],
  ecommerce: ["animated_navbar", "glassmorphism_card", "pricing_card", "feature_grid"],
  portfolio: ["animated_navbar", "glassmorphism_card", "feature_grid"],
  dashboard: ["stats_counter", "glassmorphism_card", "feature_grid"],
  blog: ["animated_navbar", "glassmorphism_card"],
};

export function getComponentsForTemplate(template: string): string[] {
  return TEMPLATE_COMPONENTS[template] ?? TEMPLATE_COMPONENTS["saas"];
}

export function buildComponentContext(template: string): string {
  const componentKeys = getComponentsForTemplate(template);
  let xml = "<available_components>\n";
  xml += "USE THESE EXACT COMPONENTS. Import and use them. Do not rewrite them. Just place them in components/ folder and import.\n\n";

  for (const key of componentKeys) {
    const code = COMPONENT_LIBRARY[key];
    if (code) {
      xml += `<component name="${key}">\n${code}\n</component>\n\n`;
    }
  }

  xml += "</available_components>";
  return xml;
}

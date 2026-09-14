export const metadata = {
  title: "Ava Roadmap | Ava Ivy",
  description: "Ava's roadmap for persistent low-power infrastructure, modular compute, energy accounting, and solar-aware operations.",
};

const sections = [
  ["01 — The Core Architecture", `                         AVA
              ┌───────────────────────┐
              │    PERSISTENT ROOT    │
              │ Low-power server      │
              │ State / automation    │
              │ Weather / monitoring  │
              │ Energy controller     │
              └───────────┬───────────┘
                          │
                     TASK QUEUE
                          │
                     DISPATCHER
                          │
          ┌───────────────┼────────────────┐
          ▼               ▼                ▼
       ROOT CPU       GPU NODE        FUTURE NODE
       Always on      On demand        Specialized
                          │
                     ENERGY LEDGER
                          │
             ┌────────────┼────────────┐
             ▼            ▼            ▼
           SOLAR       BATTERY       NETWORK`],
  ["02 — Persistent Root", `The persistent root carries Ava's essential functions: state, automation, scheduled tasks, Python services, weather collection, monitoring, APIs, task scheduling, Wake-on-LAN control, energy accounting, compute dispatch, and RootRecord services.

Ava should survive the replacement of any individual computer.`],
  ["03 — Modular Compute Nodes", `Ava's root classifies work.

LOW COMPUTE    → ROOT
MEDIUM COMPUTE → AVAILABLE NODE
HIGH COMPUTE   → GPU / SPECIALIZED NODE

A laptop, workstation, future AI server, or other machine is a resource available to Ava rather than Ava's permanent home.`],
  ["04 — Shared GPU and Gaming Hardware", `A future GPU machine may serve personal and Ava workloads.

PERSONAL: Gaming, development, creative work.
AVA: Local inference, code analysis, vision, media processing, image generation, batch work.

States may include AVAILABLE, BUSY, GAMING, RESERVED, SHARED, SLEEPING, WAKING, READY, PROCESSING, and COOLDOWN.`],
  ["05 — Wake-on-Demand Compute", `HEAVY REQUEST → NODE AVAILABLE?
YES → RUN JOB
NO → CHECK POLICY → WAKE ALLOWED?
YES → WAKE NODE → HEALTH CHECK → LOAD SERVICE → RUN TASK
NO → QUEUE TASK

Wake behavior is validated against the actual hardware. Possible mechanisms include Wake-on-LAN, scheduled wake, firmware-supported wake, controlled power recovery, or manual availability.`],
  ["06 — The Ava Energy Model", `TOTAL AVA ENERGY
=
BASELINE
+
STANDBY
+
WAKE EVENTS
+
BOOT EVENTS
+
COMPUTE
+
NETWORK
+
SHARED HARDWARE ALLOCATION

Watts describe instantaneous state. Wh and kWh describe actual work and cost over time.`],
  ["07 — Measured Hardware States", `Measure powered-off or wake-capable standby, sleep, idle, Ava-service idle, model-loaded idle, light inference, heavy inference, media processing, gaming, and gaming plus Ava.

Also measure wake energy, boot energy, time-to-ready, model loading, shutdown, and sleep transitions.`],
  ["08 — Energy-Aware Request Batching", `Request 1 ─┐
Request 2 ─┼──→ QUEUE ──→ THRESHOLD ──→ WAKE NODE ──→ PROCESS BATCH
Request 3 ─┘

Pending response. Request 3/10 in queue. Additional instructions may be added before the processing batch begins.

Waiting becomes an intentional infrastructure decision when waking a high-compute node for a single low-priority task would be inefficient.`],
  ["09 — Task Lifecycle", `RECEIVED → CLASSIFIED → QUEUED → WAITING FOR BATCH → ENERGY CHECK → APPROVED → WAKING NODE → PROCESSING → RESULT VALIDATION → RETURNED → ARCHIVED`],
  ["10 — Ava Energy Modes", `SURVIVAL: root services only.
CONSERVATION: batch heavy work and prefer low-power processing.
NORMAL: standard automation and dispatch.
SURPLUS: excess energy permits deferred work and compute wakes.
ABUNDANCE: sustained energy permits larger maintenance and processing batches.`],
  ["11 — Solar-Aware Computing", `Solar and battery conditions can influence scheduling. Excess energy can support indexing, archive processing, backup verification, log analysis, media generation, deferred code analysis, maintenance, and search or embedding rebuilds.

Excess energy becomes an opportunity for maintenance and improvement.`],
  ["12 — Shared Power Accounting", `P_Ava_incremental = P_system_with_Ava - P_system_without_Ava

If a machine is already being used, Ava is charged only for the additional measurable energy caused by her workload. If Ava wakes it solely for a task, wake, preparation, compute, and Ava-caused standby belong to that task's ledger.`],
  ["13 — The Ava Energy Ledger", `timestamp
task_id
node_id
event_type
state_before
state_after
watts
energy_wh
wake_energy_wh
boot_energy_wh
model_load_energy_wh
compute_energy_wh
network_energy_wh
shared_hardware
requests_completed

The ledger begins by measuring reality, then improves estimates from actual workloads.`],
  ["14 — Energy Cost Per Request", `A future request can report:
Root processing: measured Wh
GPU wake: measured Wh
Model preparation: measured Wh
Compute: measured Wh
Network allocation: measured Wh
TOTAL: measured Wh`],
  ["15 — Average Ava Operating Specification", `Persistent Root Average: X W
Network Average: X W
Scheduled Services: X W
AI Standby Average: X W
Average AI Request: X Wh/request
Wake Events: X/day
Average Wake Cost: X Wh/event
Total Daily Energy: X kWh/day
24-Hour Average Demand: X W

Values are populated from measured hardware and real operating history.`],
  ["16 — Compute Reservations and Priority", `Nodes can be reserved or shared. Priorities: CRITICAL, HIGH, NORMAL, LOW, BACKGROUND, MAINTENANCE.

Critical infrastructure work may wake a node immediately. Background work can wait for a favorable energy window.`],
  ["17 — Thinking Later", `A task can exist without immediately consuming the energy required to process it. Instructions can accumulate on a persistent task, then the complete batch can run when the node and energy conditions are appropriate.`],
  ["18 — Maintenance Batches", `During favorable energy conditions Ava can verify backups, index new project files, process logs, archive old data, check storage, rebuild indexes, and analyze failed jobs.`],
  ["19 — Ava Infrastructure Status", `ROOT: ONLINE
COMPUTE NODE: SLEEPING
ENERGY MODE: CONSERVATION
SOLAR: X W
BATTERY: X %
ACTIVE TASKS: X
QUEUED: X
DEFERRED: X
ENERGY TODAY: X kWh
AVERAGE POWER: X W`],
  ["20 — Development Roadmap", `PHASE 1: Measure the current Ava circuit.
PHASE 2: Build the energy logger.
PHASE 3: Define the task queue.
PHASE 4: Build the compute dispatcher.
PHASE 5: Add and measure a GPU node.
PHASE 6: Add measured energy policies.
PHASE 7: Add predictive scheduling from historical measurements.`],
  ["The Foundational Rules", `1. Ava remains rooted in persistent low-power infrastructure.
2. Heavy compute is modular and replaceable.
3. Every compute node reports availability and health.
4. Energy is measured, not guessed.
5. Watts describe state; Wh describes actual work and cost.
6. Wake events are measurable energy events.
7. Shared hardware is charged only for incremental Ava use.
8. Tasks can wait, batch, defer, or execute according to policy.
9. Solar and battery conditions can influence scheduling.
10. The architecture survives loss of optional compute nodes.
11. Hardware can evolve without moving Ava's root.
12. The energy model becomes part of Ava's operational awareness.`],
];

export default function RoadmapPage() {
  return (
    <main style={{maxWidth:1100,margin:"0 auto",padding:"48px 24px",lineHeight:1.65}}>
      <header>
        <p>ACTIVE DEVELOPMENT</p>
        <h1>AVA ROADMAP</h1>
        <h2>Energy-Aware Distributed Infrastructure</h2>
        <p>Ava is being developed as a persistent, distributed computing system.</p>
        <blockquote><strong>Ava is not a computer. Ava is a persistent system that can use computers.</strong></blockquote>
        <p>The persistent root remains online using as little energy as practical while more powerful machines can be added, removed, replaced, awakened, or placed into standby without removing Ava herself.</p>
      </header>
      {sections.map(([title, body]) => (
        <section key={title} style={{marginTop:48}}>
          <h2>{title}</h2>
          <pre style={{whiteSpace:"pre-wrap",overflowX:"auto",padding:20,border:"1px solid currentColor",borderRadius:8,lineHeight:1.5}}>{body}</pre>
        </section>
      ))}
      <section style={{marginTop:56}}>
        <h2>The Roadmap in One Sentence</h2>
        <blockquote><strong>Build Ava as a persistent low-power root with an energy-aware queue that dispatches work to specialized compute nodes only when the value of the work justifies the measured energy required to perform it.</strong></blockquote>
      </section>
    </main>
  );
}

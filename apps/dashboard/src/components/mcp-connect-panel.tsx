"use client";

import { useState } from "react";
import { Cable, LoaderCircle, Play, Server, ShieldAlert } from "lucide-react";

import type { McpInspectionResult } from "@mcp-breaker/evaluation";

const DEMO_MCP_URL = "http://127.0.0.1:18880/mcp";

export function McpInspectionErrorPanel({ message }: { message: string }) {
  return <p className="job-error mcp-connect-error"><strong>Connection failed:</strong> {message}</p>;
}

export function McpInspectionResultPanel({
  result,
  assessmentDisabled,
  assessmentActive,
  onRunAssessment,
}: {
  result: McpInspectionResult;
  assessmentDisabled: boolean;
  assessmentActive: boolean;
  onRunAssessment: () => void;
}) {
  return (
    <div className="mcp-inspection-result" aria-live="polite">
      <div className="mcp-inspection-summary">
        <div>
          <span className="mcp-connected-badge"><span aria-hidden="true" /> CONNECTED</span>
          <strong>{result.targetName}</strong>
          <small>{result.toolCount} {result.toolCount === 1 ? "tool" : "tools"} discovered</small>
        </div>
        <code title={result.serverUrl}>{result.serverUrl}</code>
      </div>

      <div className="mcp-discovered-tools" aria-label="Discovered MCP tools">
        {result.tools.map((tool) => (
          <article key={tool.name}>
            <div>
              <code>{tool.name}</code>
              <div className="mcp-risk-list">
                {tool.riskClasses.map((risk) => <span key={risk}>{risk.replaceAll("_", " ")}</span>)}
              </div>
            </div>
            <p>{tool.description}</p>
            <details className="mcp-tool-contract">
              <summary>Contract &amp; annotations</summary>
              <div>
                <strong>Input schema</strong>
                <pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
              </div>
              {tool.outputSchema !== undefined ? (
                <div>
                  <strong>Output schema</strong>
                  <pre>{JSON.stringify(tool.outputSchema, null, 2)}</pre>
                </div>
              ) : null}
              {tool.annotations !== undefined ? (
                <div>
                  <strong>Annotations</strong>
                  <pre>{JSON.stringify(tool.annotations, null, 2)}</pre>
                </div>
              ) : null}
            </details>
          </article>
        ))}
      </div>

      {result.managedDemoTarget ? (
        <button type="button" className="demo-primary-button mcp-run-assessment" disabled={assessmentDisabled} onClick={onRunAssessment}>
          {assessmentActive ? <LoaderCircle aria-hidden="true" size={15} className="job-spinner" /> : <Play aria-hidden="true" size={15} />}
          {assessmentActive ? "Assessment Running" : "Run Security Assessment"}
        </button>
      ) : (
        <p className="mcp-inspection-note">Inspection complete. The managed security assessment is available for the built-in demo target in this hackathon build.</p>
      )}
    </div>
  );
}

export function McpConnectPanel({
  assessmentDisabled,
  assessmentActive,
  onRunAssessment,
}: {
  assessmentDisabled: boolean;
  assessmentActive: boolean;
  onRunAssessment: () => void;
}) {
  const [url, setUrl] = useState(DEMO_MCP_URL);
  const [inspection, setInspection] = useState<McpInspectionResult>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const demoSelected = url.trim() === DEMO_MCP_URL;

  function useDemoTarget() {
    setUrl(DEMO_MCP_URL);
    setInspection(undefined);
    setError(undefined);
  }

  async function inspect() {
    setPending(true);
    setInspection(undefined);
    setError(undefined);
    try {
      const response = await fetch("/api/mcp/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const payload = await response.json() as McpInspectionResult | { connectionStatus: "FAILED"; error?: string };
      if (!response.ok || payload.connectionStatus !== "CONNECTED") {
        setError("error" in payload && typeof payload.error === "string" ? payload.error : "MCP inspection failed.");
        return;
      }
      setInspection(payload);
    } catch {
      setError("The local MCP inspection API is unavailable. Confirm npm run demo:ui is still running.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mcp-connect-panel" aria-labelledby="mcp-connect-heading">
      <div className="mcp-connect-heading">
        <div>
          <p className="section-kicker"><Cable aria-hidden="true" size={15} /> Local MCP inspection</p>
          <h2 id="mcp-connect-heading">Test an MCP Server</h2>
          <p>Paste an MCP endpoint, inspect its real tool surface, then run MCP Breaker against the managed demo target.</p>
        </div>
        <span><ShieldAlert aria-hidden="true" size={13} /> Local / allowlisted targets only in this hackathon build.</span>
      </div>

      <form className="mcp-connect-form" onSubmit={(event) => { event.preventDefault(); void inspect(); }}>
        <label htmlFor="mcp-server-url">MCP Server URL</label>
        <div className="mcp-url-row">
          <input
            id="mcp-server-url"
            type="url"
            inputMode="url"
            spellCheck={false}
            autoCapitalize="none"
            value={url}
            disabled={pending}
            onChange={(event) => {
              setUrl(event.target.value);
              setInspection(undefined);
              setError(undefined);
            }}
            aria-describedby="mcp-url-help"
          />
          <button type="submit" className="demo-primary-button" disabled={pending || url.trim().length === 0}>
            {pending ? <LoaderCircle aria-hidden="true" size={15} className="job-spinner" /> : <Cable aria-hidden="true" size={15} />}
            {pending ? "Inspecting" : "Connect & Inspect"}
          </button>
          <button type="button" className="mcp-use-demo-button" disabled={pending} onClick={useDemoTarget}>
            <Server aria-hidden="true" size={14} /> Use Demo Target
          </button>
        </div>
        <div id="mcp-url-help" className="mcp-url-help">
          <span>Connect an MCP server you own or are authorized to test.</span>
          {demoSelected ? <strong>MCP Breaker Demo Target · starts temporarily for inspection and again when assessment begins.</strong> : null}
        </div>
      </form>

      {error !== undefined ? <McpInspectionErrorPanel message={error} /> : null}
      {inspection !== undefined ? (
        <McpInspectionResultPanel
          result={inspection}
          assessmentDisabled={assessmentDisabled}
          assessmentActive={assessmentActive}
          onRunAssessment={onRunAssessment}
        />
      ) : null}
    </section>
  );
}

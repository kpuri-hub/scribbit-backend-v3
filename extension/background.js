// background.js
// Scribbit Fairness Scanner – Backend → UI Adapter
//
// Responsibilities:
// - Send extracted page text to backend /analyze
// - Receive AnalyzeResponse (with riskResult)
// - Broadcast riskResult to panel.js and popup.js
// - Provide stable error-handled messaging

const SCRIBBIT_BACKEND_URL = "http://localhost:8000/analyze"; // MODIFY IF NEEDED

// ---------------------------------------------------------------------------
// Call backend /analyze
// ---------------------------------------------------------------------------

async function callBackendAnalyze({ text, docName = "Page Scan" }) {
  try {
    const res = await fetch(SCRIBBIT_BACKEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        doc_name: docName,
        text,
        include_explanation: true,
        model_hint: null
      })
    });

    if (!res.ok) {
      console.warn("[Scribbit] Backend returned non-OK:", res.status);
      return null;
    }

    const data = await res.json();
    // Must contain `riskResult` for UI
    if (!data || !data.riskResult) {
      console.warn("[Scribbit] Backend returned no riskResult:", data);
      return null;
    }

    return data.riskResult;

  } catch (err) {
    console.error("[Scribbit] Backend call failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Messaging → content scripts + panel.js
// ---------------------------------------------------------------------------

function sendRiskToTabs(riskResult) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (!tab.id) continue;

      chrome.tabs.sendMessage(
        tab.id,
        {
          type: "SCRIBBIT_RISK_UPDATE",
          payload: { riskResult }
        },
        () => void chrome.runtime.lastError
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Listen for scan requests
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg || !msg.type) return;

  if (msg.type === "SCRIBBIT_SCAN_PAGE") {
    const { text, docName } = msg;

    callBackendAnalyze({ text, docName })
      .then((riskResult) => {
        if (riskResult) {
          sendRiskToTabs(riskResult);
          respond({ ok: true, riskResult });
        } else {
          respond({ ok: false, error: "Backend returned no usable data." });
        }
      })
      .catch((err) => {
        console.error("[Scribbit] analyze error:", err);
        respond({ ok: false });
      });

    // Must return true so Chrome keeps the port open
    return true;
  }
});

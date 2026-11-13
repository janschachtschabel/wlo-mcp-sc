{{- define "wlo-mcp.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "wlo-mcp.fullname" -}}
{{- default (include "wlo-mcp.name" .) .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "wlo-mcp.internalName" -}}
{{- printf "%s-internal" (include "wlo-mcp.fullname" . | trunc 54 | trimSuffix "-") -}}
{{- end -}}

{{- define "wlo-mcp.selectorLabels" -}}
app.kubernetes.io/name: {{ include "wlo-mcp.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "wlo-mcp.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
{{ include "wlo-mcp.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "wlo-mcp.image" -}}
{{- $repo := required "image.repository is required — no registry is decided yet, so the chart ships no default" .Values.image.repository -}}
{{- printf "%s:%s" $repo (default .Chart.AppVersion .Values.image.tag) -}}
{{- end -}}

{{- define "wlo-mcp.claimName" -}}
{{- default (printf "%s-data" (include "wlo-mcp.fullname" .)) .Values.persistence.existingClaim -}}
{{- end -}}

{{/*
The variables that come from `existingSecret` and from nowhere else. The
ConfigMap refuses every one of them, so a credential cannot be put in values.
*/}}
{{- define "wlo-mcp.secretKeys" -}}
WLO_SERVICE_USER WLO_SERVICE_PASSWORD WLO_AUTH_PRIVATE_KEY WLO_AUTH_PRIVATE_KEY_PREVIOUS METRICS_TOKEN TRUSTED_CLIENT_KEYS WLO_TEXT_EXTRACTION_API_KEY
{{- end -}}

{{/* Variables the chart sets itself in configmap.yaml; `config` may not override them. */}}
{{- define "wlo-mcp.fixedKeys" -}}
PORT INTERNAL_PORT WLO_REPOSITORY_URL WLO_AUTH_REGISTRY_PATH
{{- end -}}

{{/* PromQL matcher for this service's series as the ServiceMonitor labels them. */}}
{{- define "wlo-mcp.promSelector" -}}
namespace="{{ .Release.Namespace }}",job="{{ include "wlo-mcp.internalName" . }}"
{{- end -}}

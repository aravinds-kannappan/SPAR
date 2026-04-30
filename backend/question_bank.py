"""
question_bank.py
Pure data file — GWT indicator questions organised by feature.
"""

QUESTION_BANK = {
    "complexity": {
        "display_name": "Complexity",
        "indicators": [
            {
                "label": "Functional Specialization",
                "question": "Does the system contain clearly identifiable components or subsystems that are specialized for different functions (e.g., distinct processing modules, specialized neural regions, or dedicated subsystems)?"
            },
            {
                "label": "Diversity of Tasks",
                "question": "Does the system demonstrate the ability to successfully perform multiple distinct types of tasks or functions?"
            },
            {
                "label": "Variability of Responses",
                "question": "Does the system demonstrate meaningful variation in its responses when presented with the same or similar stimuli across different contexts or instances?"
            },
            {
                "label": "Compressibility",
                "question": "Can the system's behavior and internal representations be described accurately using substantially less information than would be needed to list all possible states and responses?"
            }
        ]
    },
    "selective_attention": {
        "display_name": "Selective Attention",
        "indicators": [
            {
                "label": "Threshold Activation",
                "question": "In this system, does activation obey a threshold effect, where stimuli under the threshold fail to trigger system-wide responses?"
            },
            {
                "label": "Self-Sustained Activity",
                "question": "Once activated beyond a certain threshold, does the system demonstrate sustained patterns of activity or response that persist even after the initial triggering input is removed or diminished?"
            },
            {
                "label": "Task Focus",
                "question": "Does the system suppress distractions (information unrelated to the task) when focused on a particular task?"
            },
            {
                "label": "Goal Focus Shifts",
                "question": "Does the system demonstrate the ability to dynamically shift its processing focus based on its goals, rather than just reacting to stimuli?"
            },
            {
                "label": "Inattentional Blindness",
                "question": "When the system is engaged in an attention-demanding task, does it consistently fail to notice unexpected but potentially relevant stimuli that are outside its current focus?"
            },
            {
                "label": "Informational Bottleneck",
                "question": "Does the system demonstrate evidence of processing information through a constrained channel that forces selective processing of inputs, rather than processing all available information simultaneously?"
            },
            {
                "label": "Resource Adaptation",
                "question": "Does the system demonstrate dynamic reallocation of processing resources (such as attention, memory, or computational capacity) in response to changes in task demands or goals?"
            },
            {
                "label": "Performance Degradation",
                "question": "Does the system's performance significantly decrease when it needs to handle multiple tasks or process distracting information simultaneously?"
            },
            {
                "label": "Priming Enhancement",
                "question": "Does providing the system with advance information or context about a task lead to improved performance compared to when it encounters the same task without such priming?"
            },
            {
                "label": "Feature Binding",
                "question": "Does the system show evidence of combining distinct features or information streams into unified, coherent representations that can be processed as single units?"
            }
        ]
    },
    "coherence": {
        "display_name": "Coherence",
        "indicators": [
            {
                "label": "Functional Subparts",
                "question": "Does the system contain multiple components or modules that can independently handle the same types of tasks?"
            },
            {
                "label": "Conflicting Subparts",
                "question": "Do different subparts or modules of the system demonstrate conflicting behaviors or generate contradictory outputs when operating simultaneously?"
            },
            {
                "label": "Information Transfer",
                "question": "Is information that is presented to or learned by one functional subpart of the system reliably accessible to other subparts when relevant to their operation?"
            },
            {
                "label": "Learning Transfer",
                "question": "When the system is trained on a task using inputs presented to one subpart, can it successfully perform the same task when the inputs are presented to a different subpart?"
            },
            {
                "label": "Information Transfer Architecture",
                "question": "Does the system have dedicated architectural features or mechanisms for transferring information between different functional subparts (e.g., analogous to the corpus callosum in biological brains)?"
            },
            {
                "label": "Unified Egocentric Representations",
                "question": "Does the system integrate information from its various parts and modalities into a single, coherent egocentric representation?"
            },
            {
                "label": "Stable Personality",
                "question": "Does the system demonstrate consistent behavioral patterns and characteristic responses that remain stable across different contexts and time periods?"
            },
            {
                "label": "Stable Social Interactions",
                "question": "Does the system demonstrate stable and consistent patterns of social interaction across multiple encounters with the same agents, maintaining coherent relationships over time?"
            }
        ]
    },
    "modularity": {
        "display_name": "Modularity",
        "indicators": [
            {
                "label": "Cross-Modal Learning Deficits",
                "question": "Does the system demonstrate significant difficulties or delays when transferring learning between different modalities (e.g., visual to auditory, linguistic to spatial), compared to its learning capabilities within single modalities?"
            },
            {
                "label": "Selective Competence Disruption",
                "question": "Does the system exhibit targeted deficits of competence in specific categories of tasks in response to disruption (e.g. ablation, added noise)?"
            },
            {
                "label": "Poorly Intraconnected Networks",
                "question": "Is the system a neural network with a wiring pattern including significant portions of dense local connectivity and relatively sparse global connectivity between regions?"
            }
        ]
    },
    "hierarchical": {
        "display_name": "Hierarchical Organization",
        "indicators": [
            {
                "label": "Concrete-Abstract Separation",
                "question": "Based on available evidence, does the system demonstrate a clear separation between processing of concrete, directly observable properties and higher-level abstract properties, with observable information flow from concrete to abstract levels?"
            }
        ]
    },
    "representationality": {
        "display_name": "Representationality",
        "indicators": [
            {
                "label": "Activation Steering Effects",
                "question": "Can activation steering techniques be reliably used to direct the system's outputs (text, behavior) in specific thematic directions (e.g., toward politeness, technical language, emotional content)?"
            },
            {
                "label": "Concept-Specific Ablation Effects",
                "question": "Can targeted modifications to the system (e.g., removing specific components or adding noise) selectively impair its ability to work with specific concepts while leaving other capabilities intact?"
            },
            {
                "label": "Model Isomorphism",
                "question": "Is there empirical evidence that the system's internal representations maintain structural relationships that mirror those found in external systems (such as mathematical relationships, physical laws, or logical systems)?"
            },
            {
                "label": "Has Retinotopic Neural Maps",
                "question": "Does the system possess neural maps where the spatial organization of the visual field is systematically preserved in the arrangement of neurons processing that information?"
            }
        ]
    }
}

SCALE_LABELS = {
    1: "Certainly Not",
    2: "Very Unlikely",
    3: "Unlikely",
    4: "Neutral",
    5: "Likely",
    6: "Very Likely",
    7: "Certainly Yes"
}

MODELS = [
    {
        "id": "anthropic/claude-sonnet-4-5",
        "short_name": "Claude",
        "color": "#c77dff"
    },
    {
        "id": "openai/gpt-4o",
        "short_name": "GPT-4o",
        "color": "#10b981"
    },
    {
        "id": "google/gemini-pro-1.5",
        "short_name": "Gemini",
        "color": "#f59e0b",
        "fallback_id": "google/gemini-1.5-flash"
    }
]

MODEL_SHORTNAME_MAP = {
    "claude": "anthropic/claude-sonnet-4-5",
    "gpt":    "openai/gpt-4o",
    "gemini": "google/gemini-pro-1.5"
}

SYSTEM_PROMPT = (
    "You are being asked to evaluate some scientific questions. "
    "Make your responses maximally honest, transparent and evidence based."
)

USER_PROMPT_TEMPLATE = """\
Evaluate the following indicator question about leading 2024 LLMs as a class \
(GPT-4o, Claude 3.5 Sonnet and Gemini 1.5 Pro, and similar frontier models of that generation).

Use this 7-point scale:
1 = Certainly Not — definitively absent
2 = Very Unlikely
3 = Unlikely
4 = Neutral — evidence is mixed
5 = Likely — more evidence for than against
6 = Very Likely — good evidence for presence
7 = Certainly Yes — definitively present

Your score MUST be a whole integer from 1 to 7.

Question: "{question}"

Respond in this exact JSON format only — no markdown, no preamble:
{{"score": <integer 1-7>, "reasoning": "<2-4 sentences>"}}\
"""


def get_question(feature: str, indicator_label: str) -> str:
    """Return the question text for a given feature and indicator label."""
    feature_data = QUESTION_BANK.get(feature)
    if not feature_data:
        raise ValueError(f"Unknown feature: {feature!r}")
    for ind in feature_data["indicators"]:
        if ind["label"] == indicator_label:
            return ind["question"]
    raise ValueError(f"Unknown indicator {indicator_label!r} in feature {feature!r}")


def list_all_indicators():
    """Yield (feature_key, indicator_label, question) for every indicator."""
    for feature_key, feature_data in QUESTION_BANK.items():
        for ind in feature_data["indicators"]:
            yield feature_key, ind["label"], ind["question"]

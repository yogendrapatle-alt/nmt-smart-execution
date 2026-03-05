import psycopg2
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/webhook', methods=['POST'])
def webhook():
    data = request.get_json(force=True)
    alerts = data.get('alerts', [])

    try:
        # 🔁 UPDATE host if Postgres is inside Docker (e.g., '172.17.0.2' or container name)
        conn = psycopg2.connect(
            dbname="alerts",
            user="alertuser",
            password="alertpass",
            host="10.117.66.44",  # <-- Replace with actual IP if needed
            port="5432"
        )
        cur = conn.cursor()

        for alert in alerts:
            alertname = alert.get("labels", {}).get("alertname", "unknown")
            status = alert.get("status", "unknown")
            summary = alert.get("annotations", {}).get("summary", "")
            description = alert.get("annotations", {}).get("description", "")
            starts_at = alert.get("startsAt", "")
            severity = alert.get("labels", {}).get("severity", "unknown")    # <-- include severity
            
            cur.execute(
                """
                INSERT INTO alerts (alertname, status, summary, description, starts_at, severity)  # <-- include severity
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (alertname, status, summary, description, starts_at, severity)    # <-- include severity
            )

        conn.commit()
        cur.close()
        conn.close()
        print("Alerts saved to database successfully.")
        return jsonify({"status": "received"}), 200

    except Exception as e:
        print("Database insert error:", e)
        return jsonify({"error": str(e)}), 500

# This is important! Set port to 5002
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5002)

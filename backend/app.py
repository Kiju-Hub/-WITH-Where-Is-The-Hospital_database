from flask import Flask, jsonify, request
from flask_cors import CORS
import csv
import os

app = Flask(__name__)
CORS(app)

CSV_FILE = os.path.join(os.path.dirname(__file__), "data", "hospitals.csv")

@app.route("/")
def home():
    return "WITH Flask API Running (CSV Mode)"

@app.route("/api/hospitals")
def get_hospitals():
    region = request.args.get("region")
    result = []

    with open(CSV_FILE, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if region in row["주소"]:
                result.append(row)

    return jsonify(result)

if __name__ == "__main__":
    app.run(debug=True)

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Bei Builds auf GitHub Actions steigt die Versionsnummer mit jedem Lauf,
// damit sich neue APKs als Update über die alte Version installieren lassen.
val buildNumber = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "ch.sterneversenken.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "ch.sterneversenken.app"
        minSdk = 26
        targetSdk = 35
        versionCode = buildNumber
        versionName = "1.0.$buildNumber"
    }

    signingConfigs {
        // Fester Schlüssel nur fürs direkte Installieren (Sideloading), nicht für den Play Store.
        // So passen alle Builds zusammen und Updates lassen sich ohne Deinstallation einspielen.
        create("sideload") {
            storeFile = file("sideload.jks")
            storePassword = "sterneversenken"
            keyAlias = "sideload"
            keyPassword = "sterneversenken"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("sideload")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("sideload")
        }
    }

    // Das Spiel selbst (HTML/CSS/JS) liegt in /web und wird als Asset eingebunden.
    sourceSets {
        getByName("main") {
            assets.srcDir("../web")
        }
    }

    lint {
        checkReleaseBuilds = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("com.google.android.gms:play-services-nearby:19.3.0")
}
